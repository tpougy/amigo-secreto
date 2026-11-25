// Helpers for the integration tests. They ALWAYS use the dedicated test app
// (`instant-commands-teste`), configured via IC_TEST_APP_ID / IC_TEST_ADMIN_TOKEN.
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init, type InstantAdminDatabase, type InstantUnknownSchema } from "@instantdb/admin";
import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";

// Replaced by the schema from testes/app/schema.ts in Task 8 (see `adminIC`).
type TestSchema = InstantUnknownSchema;

function require_(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env var ${name} (see .env.example)`);
  return v;
}

function config() {
  return {
    appId: require_("IC_TEST_APP_ID"),
    adminToken: require_("IC_TEST_ADMIN_TOKEN"),
    apiURI: process.env.INSTANT_API_URI ?? "https://instant.tpou.gy",
  };
}

/** Admin client for the test app, typed with the test schema (until Task 8: no schema). */
export function adminIC(): InstantAdminDatabase<TestSchema> {
  return init(config()) as InstantAdminDatabase<TestSchema>;
}

/** Admin client without schema, for system entities and the connection test. */
export function adminICSemSchema(): InstantAdminDatabase<InstantUnknownSchema> {
  return init(config());
}

/** Unique prefix per test run, to isolate each file's data in the shared test app. */
export function novoPrefixo(nome: string): string {
  return `t${Date.now().toString(36)}-${nome}`;
}

/** Waits until `cond` becomes true, polling every 100 ms. */
export async function esperarAte(cond: () => Promise<boolean>, prazoMs = 5000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < prazoMs) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`condition did not become true within ${prazoMs} ms`);
}

/** OpenWorkflow backed by a temporary SQLite file; `limpar` stops the backend and deletes the files. */
export function owTemporario(nome: string): {
  ow: OpenWorkflow;
  backend: BackendSqlite;
  arquivo: string;
  limpar(): Promise<void>;
} {
  const arquivo = join(tmpdir(), `ic-${nome}-${Date.now().toString(36)}-${crypto.randomUUID()}.db`);
  const backend = BackendSqlite.connect(arquivo);
  const ow = new OpenWorkflow({ backend });
  return {
    ow,
    backend,
    arquivo,
    async limpar() {
      await backend.stop();
      for (const suf of ["", "-wal", "-shm"]) rmSync(arquivo + suf, { force: true });
    },
  };
}
