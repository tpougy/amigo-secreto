// Validação de entrada (schema Zod) dos workflows: input inválido é rejeitado em `run`,
// antes de criar qualquer run no ow.db.
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { id } from "@instantdb/admin";
import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";
import { adminTeste, novoPrefixo } from "@amigo/instant/teste";
import { definirApagarConta } from "./apagarConta";
import { definirReabrirGrupo } from "./reabrirGrupo";
import { definirSorteio } from "./sortear";

const ARQUIVO = join(process.env.OW_TESTE_DIR ?? tmpdir(), `ow-teste-${novoPrefixo("worker-entradas")}.db`);
const backend = BackendSqlite.connect(ARQUIVO);
const ow = new OpenWorkflow({ backend });
const admin = adminTeste();
const sorteio = definirSorteio(ow, admin, { segredo: "0123456789abcdef".repeat(4) });
const reabrir = definirReabrirGrupo(ow, admin);
const apagar = definirApagarConta(ow, admin);

function totalRuns(): number {
  const db = new Database(ARQUIVO, { readonly: true });
  try {
    return (db.query("select count(*) as n from workflow_runs").get() as { n: number }).n;
  } finally {
    db.close();
  }
}

afterAll(async () => {
  await backend.stop();
  for (const suf of ["", "-wal", "-shm"]) rmSync(ARQUIVO + suf, { force: true });
});

describe("entrada dos workflows", () => {
  test("sortear rejeita sorteioId inválido sem criar run", async () => {
    await expect(sorteio.run({ sorteioId: "nao-e-uuid" })).rejects.toThrow();
    // @ts-expect-error entrada sem o campo obrigatório
    await expect(sorteio.run({})).rejects.toThrow();
    expect(totalRuns()).toBe(0);
  });

  test("reabrir-grupo rejeita reaberturaId inválido sem criar run", async () => {
    await expect(reabrir.run({ reaberturaId: "123" })).rejects.toThrow();
    // @ts-expect-error campo errado
    await expect(reabrir.run({ sorteioId: id() })).rejects.toThrow();
    expect(totalRuns()).toBe(0);
  });

  test("apagar-conta rejeita pedidoId inválido sem criar run", async () => {
    await expect(apagar.run({ pedidoId: "" })).rejects.toThrow();
    // @ts-expect-error tipo errado
    await expect(apagar.run({ pedidoId: 42 })).rejects.toThrow();
    expect(totalRuns()).toBe(0);
  });
});
