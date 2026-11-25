// Helpers for the integration tests. They ALWAYS use the dedicated test app
// (`instant-commands-teste`), configured via IC_TEST_APP_ID / IC_TEST_ADMIN_TOKEN.
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { id, init, type InstantAdminDatabase, type InstantUnknownSchema } from "@instantdb/admin";
import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";
import schema, { type TestSchema } from "./app/schema";

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

/** Admin client for the test app, typed with the test schema. */
export function adminIC(): InstantAdminDatabase<TestSchema> {
  return init({ ...config(), schema });
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

const EMAIL_DOMAIN = "teste.ic";
const PREFIX_RE = /^t([0-9a-z]+)-/;

/** A fresh user and an admin-derived client acting as them. One per test: the rate limit is per user. */
export async function novoUsuario(
  prefixo: string,
): Promise<{ email: string; id: string; db: InstantAdminDatabase<TestSchema> }> {
  const email = `${prefixo}-${crypto.randomUUID()}@${EMAIL_DOMAIN}`;
  const admin = adminIC();
  await admin.auth.createToken({ email });
  const u = await admin.auth.getUser({ email });
  if (!u) throw new Error("test user was not created");
  return { email, id: u.id, db: admin.asUser({ email }) };
}

/** Creates a group (as admin) organized by `organizador`; the title carries the prefix for cleanup. */
export async function criarGrupo(prefixo: string, organizador: { id: string }): Promise<string> {
  const grupoId = id();
  await adminIC().transact(
    adminIC()
      .tx.grupos[grupoId]!.create({ titulo: `${prefixo}-${grupoId}`, status: "aberto" })
      .link({ organizador: organizador.id }),
  );
  return grupoId;
}

async function apagar(ok: (valor: string) => boolean): Promise<void> {
  const admin = adminIC();
  const { grupos, $users } = await admin.query({ grupos: {}, $users: {} });
  // Deleting a group cascades to its commands.
  const gruposApagar = grupos.filter((g) => ok(g.titulo));
  const usuariosApagar = $users.filter((u) => u.email?.endsWith(`@${EMAIL_DOMAIN}`) && ok(u.email));
  for (const g of gruposApagar) await admin.transact(admin.tx.grupos[g.id]!.delete());
  for (const u of usuariosApagar) await admin.transact(admin.tx.$users[u.id]!.delete());
}

/** Deletes the data (groups, their commands, users) created under `prefixo`. */
export async function limpar(prefixo: string): Promise<void> {
  await apagar((v) => v.startsWith(`${prefixo}-`));
}

/** Deletes leftovers of `t*` prefixes older than 1 hour (aborted earlier runs); for `beforeAll`. */
export async function limparRestos(): Promise<void> {
  const limite = Date.now() - 60 * 60 * 1000;
  await apagar((v) => {
    const m = PREFIX_RE.exec(v);
    return m !== null && parseInt(m[1]!, 36) < limite;
  });
}
