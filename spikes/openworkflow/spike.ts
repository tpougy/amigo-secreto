// SPIKE DESCARTÁVEL — OpenWorkflow + bun:sqlite. Não é código de produção.
// Uso:
//   bun spike.ts worker                  # sobe o worker (fica rodando)
//   bun spike.ts enqueue <id> [lento]    # enfileira um "sorteio" (idempotencyKey = id)
//   bun spike.ts status                  # lista runs e contagem de efeitos por passo
import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const DB = process.env.OW_DB ?? "./ow.db";
const EFEITOS = "./efeitos.log"; // cada execução real de um passo deixa uma linha aqui

const backend = BackendSqlite.connect(DB);
const ow = new OpenWorkflow({ backend });

const efeito = (runKey: string, passo: string) =>
  appendFileSync(EFEITOS, `${new Date().toISOString()} ${runKey} ${passo}\n`);
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

// sorteio puro (o que seria dominio/sortear)
function sortear(ids: string[]): [string, string][] {
  const a = [...ids].sort(() => Math.random() - 0.5);
  return a.map((d, i) => [d, a[(i + 1) % a.length]!]);
}

type Entrada = { sorteioId: string; lento?: boolean; falhas?: number };

const sorteioWf = ow.defineWorkflow<Entrada, { pares: number }>(
  { name: "sortear", retryPolicy: { maximumAttempts: 5 } as any },
  async ({ input, step }) => {
    const participantes = await step.run({ name: "carregar-participantes" }, async () => {
      efeito(input.sorteioId, "carregar");
      await dormir(1000);
      return ["ana", "bia", "caio", "duda", "edu"];
    });

    // passo "longo" (simula várias chamadas de LLM): 90 s > lease padrão de 30 s
    if (input.lento) {
      await step.run({ name: "passo-longo" }, async () => {
        efeito(input.sorteioId, "longo-inicio");
        await dormir(90_000);
        efeito(input.sorteioId, "longo-fim");
        return "ok";
      });
    }

    // passo que falha N vezes antes de passar (testa retry)
    await step.run({ name: "instavel" }, async () => {
      efeito(input.sorteioId, "instavel");
      const tentativas = readFileSync(EFEITOS, "utf8")
        .split("\n")
        .filter((l) => l.includes(`${input.sorteioId} instavel`)).length;
      if (tentativas <= (input.falhas ?? 0)) throw new Error(`falha forçada #${tentativas}`);
      return tentativas;
    });

    const pares = await step.run({ name: "sortear" }, async () => {
      efeito(input.sorteioId, "sortear");
      await dormir(3000); // janela para kill -9 no meio
      return sortear(participantes);
    });

    await step.run({ name: "gravar-pares" }, async () => {
      efeito(input.sorteioId, "gravar");
      return pares.length;
    });

    return { pares: pares.length };
  },
);

const [cmd, arg, flag] = process.argv.slice(2);

if (cmd === "worker") {
  const worker = ow.newWorker({ concurrency: 2 });
  await worker.start();
  console.log(`[worker] pid=${process.pid} rodando`);
  setInterval(() => {
    const m = process.memoryUsage();
    console.log(`[mem] rss=${(m.rss / 1e6).toFixed(1)}MB heap=${(m.heapUsed / 1e6).toFixed(1)}MB`);
  }, 15_000);
  for (const sig of ["SIGINT", "SIGTERM"] as const)
    process.on(sig, async () => {
      console.log(`[worker] ${sig}: parando com graça`);
      await worker.stop();
      process.exit(0);
    });
} else if (cmd === "enqueue") {
  const h = await sorteioWf.run(
    { sorteioId: arg!, lento: flag === "lento", falhas: flag === "instavel" ? 2 : 0 },
    { idempotencyKey: arg! },
  );
  console.log(`enfileirado run=${h.workflowRun.id} status=${h.workflowRun.status}`);
  process.exit(0);
} else if (cmd === "status") {
  const { Database } = await import("bun:sqlite");
  const db = new Database(DB, { readonly: true });
  console.log(db.query("select id, idempotency_key, status, attempts from workflow_runs order by created_at").all());
  if (existsSync(EFEITOS)) console.log(readFileSync(EFEITOS, "utf8"));
  process.exit(0);
}
