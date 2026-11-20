// Integração do workflow `sortear`: app de TESTE do Instant + worker real do OpenWorkflow
// (SQLite num arquivo temporário, concorrência 1).
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { id } from "@instantdb/admin";
import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";
import {
  adminTeste,
  criarGrupoTeste,
  criarUsuario,
  entrar,
  limparTudo,
  novoPrefixo,
  type Usuario,
} from "../../testes/instant-teste";
import { carregar, definirSorteio, gravarPares, processarPendentes, type Carga } from "./sortear";

setDefaultTimeout(60_000);

const PREFIXO = novoPrefixo("worker-sortear");
const admin = adminTeste();
const DIR = process.env.OW_TESTE_DIR ?? tmpdir();
const OW_DB = join(DIR, `ow-teste-${PREFIXO}.db`);

type Ambiente = Awaited<ReturnType<typeof montar>>;

async function montar(arquivo: string) {
  const backend = BackendSqlite.connect(arquivo);
  const ow = new OpenWorkflow({ backend });
  const wf = definirSorteio(ow, admin);
  const worker = ow.newWorker({ concurrency: 1 });
  await worker.start();
  return {
    ow,
    wf,
    async parar() {
      await worker.stop();
      await backend.stop();
    },
  };
}

function apagarOwDb() {
  for (const suf of ["", "-wal", "-shm"]) rmSync(OW_DB + suf, { force: true });
}

/** Linhas de `workflow_runs` para a chave (lidas direto do SQLite). */
function runsDaChave(chave: string): { id: string; status: string; attempts: number }[] {
  const db = new Database(OW_DB, { readonly: true });
  try {
    return db
      .query("select id, status, attempts from workflow_runs where idempotency_key = ?")
      .all(chave) as { id: string; status: string; attempts: number }[];
  } finally {
    db.close();
  }
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function lerSorteio(sorteioId: string) {
  const r = await admin.query({ sorteios: { $: { where: { id: sorteioId } }, pares: {}, grupo: {} } });
  return r.sorteios[0];
}

/** Espera o sorteio sair de pendente/processando (ou estoura o prazo). */
async function esperarFim(sorteioId: string, prazoMs = 15_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < prazoMs) {
    const s = await lerSorteio(sorteioId);
    if (s && s.status !== "pendente" && s.status !== "processando") return { s, ms: Date.now() - t0 };
    await dormir(250);
  }
  throw new Error(`sorteio não terminou em ${prazoMs} ms`);
}

/** Espera o run da chave terminar no OpenWorkflow. */
async function esperarRun(chave: string, prazoMs = 10_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < prazoMs) {
    const r = runsDaChave(chave);
    if (r.length && r.every((x) => x.status === "completed" || x.status === "failed")) return r;
    await dormir(100);
  }
  throw new Error("run não terminou");
}

type Grupo = { grupoId: string; org: Usuario; usuarios: Usuario[]; participantes: string[] };

/** Grupo com `n` participantes (o organizador é o primeiro). */
async function grupoCom(n: number): Promise<Grupo> {
  const org = await criarUsuario(PREFIXO);
  const g = await criarGrupoTeste(org);
  const usuarios = [org];
  const participantes = [await entrar(org, g.grupoId, g.codigo)];
  for (let i = 1; i < n; i++) {
    const u = await criarUsuario(PREFIXO);
    usuarios.push(u);
    participantes.push(await entrar(u, g.grupoId, g.codigo));
  }
  return { grupoId: g.grupoId, org, usuarios, participantes };
}

/** O organizador pede o sorteio da rodada (como o botão "Sortear"). */
async function pedirSorteio(g: Grupo, rodada: number): Promise<string> {
  const sorteioId = id();
  await g.org.db.transact(
    g.org.db.tx.sorteios[sorteioId]!
      .create({ status: "pendente", rodada, chave: `${g.grupoId}:${rodada}`, criadoEm: Date.now() })
      .link({ grupo: g.grupoId }),
  );
  return sorteioId;
}

async function restringir(g: Grupo, a: string, b: string) {
  await g.org.db.transact(
    g.org.db.tx.restricoes[id()]!.create({}).link({ grupo: g.grupoId, participanteA: a, participanteB: b }),
  );
}

async function remover(participanteId: string) {
  await admin.transact(admin.tx.participantes[participanteId]!.update({ removido: true }));
}

async function lerGrupo(grupoId: string) {
  return (await admin.query({ grupos: { $: { where: { id: grupoId } } } })).grupos[0]!;
}

async function paresDoGrupo(grupoId: string) {
  const r = await admin.query({
    pares: { $: { where: { "sorteio.grupo.id": grupoId } }, doador: {}, receptor: {}, sorteio: {} },
  });
  return r.pares;
}

let amb: Ambiente;
let campainha: { parar(): void } | undefined;

function ligarCampainha() {
  campainha?.parar();
  campainha = processarPendentes(amb.ow, admin);
}

beforeAll(async () => {
  apagarOwDb();
  amb = await montar(OW_DB);
  ligarCampainha();
});

afterAll(async () => {
  campainha?.parar();
  await amb?.parar();
  apagarOwDb();
  await limparTudo(PREFIXO);
});

describe("workflow sortear", () => {
  let G1: Grupo;
  let sorteio1: string;
  let pares1: string[];

  test("1. fluxo feliz: 4 participantes, rodada 1 conclui em até 15 s", async () => {
    G1 = await grupoCom(4);
    sorteio1 = await pedirSorteio(G1, 1);
    const { s, ms } = await esperarFim(sorteio1);
    console.log(`[tempo] fluxo feliz: ${ms} ms`);
    expect(s.status).toBe("concluido");
    expect(s.erro ?? null).toBeNull();
    expect(s.concluidoEm).toBeDefined();
    expect(s.pares).toHaveLength(4);
    pares1 = s.pares.map((p) => p.id).sort();

    const g = await lerGrupo(G1.grupoId);
    expect(g.status).toBe("sorteado");
    expect(g.rodadaAtual).toBe(1);

    // Cada doador vê exatamente 1 par, o dele.
    const receptores = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const r = await G1.usuarios[i]!.db.query({ pares: { doador: {}, receptor: {} } });
      expect(r.pares).toHaveLength(1);
      expect(r.pares[0]!.doador?.id).toBe(G1.participantes[i]!);
      expect(r.pares[0]!.receptor?.id).not.toBe(G1.participantes[i]!);
      receptores.add(r.pares[0]!.receptor!.id);
    }
    expect(receptores.size).toBe(4);
  });

  test("2. dois run com o mesmo sorteioId geram um único run", async () => {
    const h1 = await amb.wf.run({ sorteioId: sorteio1 }, { idempotencyKey: sorteio1 });
    const h2 = await amb.wf.run({ sorteioId: sorteio1 }, { idempotencyKey: sorteio1 });
    expect(h2.workflowRun.id).toBe(h1.workflowRun.id);
    expect(runsDaChave(sorteio1)).toHaveLength(1);
  });

  test("3. idempotência sem o OpenWorkflow: ow.db apagado, mesmo sorteio não muda nada", async () => {
    campainha?.parar();
    await amb.parar();
    apagarOwDb();
    amb = await montar(OW_DB);
    expect(runsDaChave(sorteio1)).toHaveLength(0);

    const h = await amb.wf.run({ sorteioId: sorteio1 }, { idempotencyKey: sorteio1 });
    expect(await h.result({ timeoutMs: 15_000 })).toEqual({ pares: 0 });
    const s = await lerSorteio(sorteio1);
    expect(s!.status).toBe("concluido");
    expect(s!.pares.map((p) => p.id).sort()).toEqual(pares1);
    expect((await lerGrupo(G1.grupoId)).rodadaAtual).toBe(1);
    ligarCampainha();
  });

  test("5. refazer: participante removido, rodada 2 apaga os pares antigos e grava 3 novos", async () => {
    await remover(G1.participantes[3]!);
    const sorteio2 = await pedirSorteio(G1, 2);
    const { s } = await esperarFim(sorteio2);
    expect(s.status).toBe("concluido");
    expect(s.pares).toHaveLength(3);

    const todos = await paresDoGrupo(G1.grupoId);
    expect(todos).toHaveLength(3);
    expect(todos.every((p) => p.sorteio?.id === sorteio2)).toBe(true);
    expect(todos.some((p) => pares1.includes(p.id))).toBe(false);
    const ativos = G1.participantes.slice(0, 3).sort();
    expect(todos.map((p) => p.doador!.id).sort()).toEqual(ativos);
    expect(todos.map((p) => p.receptor!.id).sort()).toEqual(ativos);

    const g = await lerGrupo(G1.grupoId);
    expect(g.rodadaAtual).toBe(2);
    expect(g.status).toBe("sorteado");
  });

  test("4. restrições impossíveis: erro sem retry, chave liberada, grupo continua aberto", async () => {
    const G = await grupoCom(3);
    const [a, b, c] = G.participantes as [string, string, string];
    await restringir(G, a, b);
    await restringir(G, b, c);
    const sorteioId = await pedirSorteio(G, 1);
    const { s } = await esperarFim(sorteioId);
    expect(s.status).toBe("erro");
    expect(s.erro).toBe("As restrições tornam o sorteio impossível");
    expect(s.chave).toBe(`${G.grupoId}:1:erro:${sorteioId}`);
    expect(s.pares).toHaveLength(0);

    const runs = await esperarRun(sorteioId);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("completed");
    expect(runs[0]!.attempts).toBe(1);

    const g = await lerGrupo(G.grupoId);
    expect(g.status).toBe("aberto");
    expect(g.rodadaAtual).toBe(0);
  });

  test("6. restrição citando participante removido é ignorada (Review Focus 2)", async () => {
    const G = await grupoCom(4);
    const [a, b, c, d] = G.participantes as [string, string, string, string];
    // d bloqueia todos; sem d, nada impede o sorteio.
    await restringir(G, a, d);
    await restringir(G, d, b);
    await restringir(G, c, d);
    await remover(d);
    const sorteioId = await pedirSorteio(G, 1);
    const { s } = await esperarFim(sorteioId);
    expect(s.status).toBe("concluido");
    expect(s.pares).toHaveLength(3);
  });

  test("7. grupo com 2 participantes ativos: erro de poucos participantes", async () => {
    const G = await grupoCom(3);
    await remover(G.participantes[2]!);
    const sorteioId = await pedirSorteio(G, 1);
    const { s } = await esperarFim(sorteioId);
    expect(s.status).toBe("erro");
    expect(s.erro).toBe("São necessários pelo menos 3 participantes");
    expect((await lerGrupo(G.grupoId)).status).toBe("aberto");
  });

  test("rodada inválida: erro 'Rodada inválida' (sorteio criado pelo admin)", async () => {
    const G = await grupoCom(3);
    const sorteioId = id();
    await admin.transact(
      admin.tx.sorteios[sorteioId]!
        .create({ status: "pendente", rodada: 2, chave: `${G.grupoId}:2`, criadoEm: Date.now() })
        .link({ grupo: G.grupoId }),
    );
    const { s } = await esperarFim(sorteioId);
    expect(s.status).toBe("erro");
    expect(s.erro).toBe("Rodada inválida");
    expect(s.chave).toBe(`${G.grupoId}:2:erro:${sorteioId}`);
  });

  test("campo 'erro' posto pelo cliente não sobrevive à conclusão", async () => {
    const G = await grupoCom(3);
    const sorteioId = id();
    await G.org.db.transact(
      G.org.db.tx.sorteios[sorteioId]!
        .create({
          status: "pendente",
          rodada: 1,
          chave: `${G.grupoId}:1`,
          criadoEm: Date.now(),
          erro: "forjado",
          concluidoEm: 1,
        })
        .link({ grupo: G.grupoId }),
    );
    const { s } = await esperarFim(sorteioId);
    expect(s.status).toBe("concluido");
    expect(s.erro ?? null).toBeNull();
    expect(s.concluidoEm).toBeGreaterThan(1);
  });

  test("8. reexecutar gravar-pares: os mesmos 4 pares, sem duplicar", async () => {
    campainha?.parar(); // o worker não deve pegar este sorteio
    campainha = undefined;
    const G = await grupoCom(4);
    const sorteioId = await pedirSorteio(G, 1);
    const carga = (await carregar(admin, sorteioId)) as Carga;
    expect(carga.participantes).toHaveLength(4);

    expect(await gravarPares(admin, sorteioId, carga)).toBe(4);
    const primeira = (await paresDoGrupo(G.grupoId)).map((p) => `${p.id}|${p.doador!.id}|${p.receptor!.id}`).sort();
    expect(await gravarPares(admin, sorteioId, carga)).toBe(4);
    const segunda = (await paresDoGrupo(G.grupoId)).map((p) => `${p.id}|${p.doador!.id}|${p.receptor!.id}`).sort();

    expect(primeira).toHaveLength(4);
    expect(segunda).toEqual(primeira);
    const s = await lerSorteio(sorteioId);
    expect(s!.status).toBe("concluido");
    expect(s!.pares).toHaveLength(4);
  });
});
