// Workflow `limpar-historico`: apaga do ow.db os runs encerrados há mais de N dias.
// Só SQLite (arquivo temporário) + worker real do OpenWorkflow; não toca no Instant.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineWorkflowSpec, OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";
import { apagarEncerrados, CRON_LIMPEZA, definirLimpeza, specLimpar } from "./limparHistorico";

setDefaultTimeout(30_000);

const OW_DB = join(process.env.OW_TESTE_DIR ?? tmpdir(), `ow-teste-limpar-${Date.now()}.db`);
const DIA_MS = 24 * 60 * 60 * 1000;

const specEco = defineWorkflowSpec<{ n: number }, number>({ name: "eco", version: "1" });

let ow: OpenWorkflow;
let parar: () => Promise<void>;

beforeAll(async () => {
  const backend = BackendSqlite.connect(OW_DB);
  ow = new OpenWorkflow({ backend });
  ow.defineWorkflow(specEco, async ({ input, step }) => step.run({ name: "dobrar" }, () => input.n * 2));
  await definirLimpeza(ow, OW_DB);
  const worker = ow.newWorker({ concurrency: 1 });
  await worker.start();
  parar = () => worker.stop();
});

afterAll(async () => {
  await parar?.();
  for (const suf of ["", "-wal", "-shm"]) rmSync(OW_DB + suf, { force: true });
});

/** Roda um `eco` até o fim e devolve o id do run. */
async function runConcluido(n: number): Promise<string> {
  const h = await ow.runWorkflow(specEco, { n });
  expect(await h.result()).toBe(n * 2);
  return h.workflowRun.id;
}

function sql() {
  const db = new Database(OW_DB);
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}

describe("limpar-historico", () => {
  test("apaga só runs encerrados antes do corte, com os passos deles", async () => {
    const velho = await runConcluido(1);
    const recente = await runConcluido(2);
    const falhoVelho = await runConcluido(3);
    const db = sql();
    const antigo = new Date(Date.now() - 40 * DIA_MS).toISOString();
    db.run(`UPDATE workflow_runs SET finished_at = ? WHERE id IN (?, ?)`, [antigo, velho, falhoVelho]);
    db.run(`UPDATE workflow_runs SET status = 'failed' WHERE id = ?`, [falhoVelho]);
    // Um run "pendente" antigo (sem finished_at) nunca é apagado.
    db.run(
      `UPDATE workflow_runs SET status = 'pending', finished_at = NULL, created_at = ? WHERE id = ?`,
      [antigo, recente],
    );
    db.close();

    const apagados = apagarEncerrados(OW_DB, new Date(), 30);

    expect(apagados).toBe(2);
    const db2 = sql();
    const ids = (db2.query(`SELECT id FROM workflow_runs`).all() as { id: string }[]).map((r) => r.id);
    expect(ids).toContain(recente);
    expect(ids).not.toContain(velho);
    expect(ids).not.toContain(falhoVelho);
    const passosOrfaos = db2
      .query(`SELECT COUNT(*) AS n FROM step_attempts WHERE workflow_run_id IN (?, ?)`)
      .get(velho, falhoVelho) as { n: number };
    expect(passosOrfaos.n).toBe(0);
    db2.run(`DELETE FROM workflow_runs WHERE id = ?`, [recente]); // não deixar pendente para o worker
    db2.close();
  });

  test("run recente encerrado fica", async () => {
    const id = await runConcluido(4);
    expect(apagarEncerrados(OW_DB, new Date(), 30)).toBe(0);
    const db = sql();
    expect(db.query(`SELECT 1 FROM workflow_runs WHERE id = ?`).get(id)).not.toBeNull();
    db.close();
  });

  test("registra o agendamento diário", () => {
    const db = sql();
    const s = db
      .query(`SELECT cron, timezone FROM workflow_schedules WHERE workflow_name = ?`)
      .get(specLimpar.name) as { cron: string; timezone: string } | null;
    db.close();
    // O OpenWorkflow normaliza o cron para 6 campos (segundos na frente).
    expect(s).toEqual({ cron: `0 ${CRON_LIMPEZA}`, timezone: "America/Sao_Paulo" });
  });

  test("o workflow roda pelo worker com entrada null", async () => {
    const h = await ow.runWorkflow(specLimpar, null);
    expect(await h.result()).toEqual({ apagados: 0 });
  });
});
