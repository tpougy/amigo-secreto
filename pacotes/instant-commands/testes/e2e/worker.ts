// Webhook-mode runner for the VPS e2e (Dokku app `ic-teste-worker`). Test app only; never production.
import { init } from "@instantdb/admin";
import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";
import { initCommands } from "../../src/worker";
import { sortear } from "../app/commands";
import schema, { type TestSchema } from "../app/schema";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env var ${name}`);
  return v;
}

const db = init({
  appId: need("IC_TEST_APP_ID"),
  adminToken: need("IC_TEST_ADMIN_TOKEN"),
  apiURI: process.env.INSTANT_API_URI ?? "https://instant.tpou.gy",
  schema,
});
const ow = new OpenWorkflow({ backend: BackendSqlite.connect(process.env.OW_DB ?? "/data/ow.db") });
const { defineHandler, createRunner } = initCommands<TestSchema>();

const runner = createRunner({
  ow,
  db,
  handlers: [defineHandler(sortear, async () => ({ pares: 0 }))],
  trigger: { type: "webhook", publicUrl: need("WEBHOOK_URL") },
  onEvent: (e) => console.log(JSON.stringify(e)),
});
await runner.start();

for (const sinal of ["SIGTERM", "SIGINT"] as const) {
  process.on(sinal, () => void runner.stop().then(() => process.exit(0)));
}
