// Processo principal do worker: OpenWorkflow (SQLite) + campainha do Instant.
// Env: INSTANT_APP_ID, INSTANT_ADMIN_TOKEN, INSTANT_API_URI, OW_DB (/data/ow.db), OW_CONCORRENCIA (2).
import { init } from "@instantdb/admin";
import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";
import schema from "../instant.schema";
import { log } from "./nucleo/log";
import { definirSorteio, processarPendentes } from "./workflows/sortear";

/** Força uma reassinatura periódica: cobre conexões meio-abertas que nunca dão erro. */
const RENOVAR_CAMPAINHA_MS = 10 * 60 * 1000;

function exigir(nome: string): string {
  const v = process.env[nome];
  if (!v) {
    log("worker.config_ausente", { variavel: nome });
    process.exit(1);
  }
  return v;
}

const db = init({
  appId: exigir("INSTANT_APP_ID"),
  adminToken: exigir("INSTANT_ADMIN_TOKEN"),
  apiURI: exigir("INSTANT_API_URI"),
  schema,
});
const concorrencia = Number(process.env.OW_CONCORRENCIA ?? "2") || 2;

const backend = BackendSqlite.connect(process.env.OW_DB ?? "/data/ow.db");
const ow = new OpenWorkflow({ backend });
definirSorteio(ow, db);

const worker = ow.newWorker({ concurrency: concorrencia });
await worker.start();
log("worker.iniciado", { concorrencia, pid: process.pid });

let campainha = processarPendentes(ow, db);
const watchdog = setInterval(() => {
  campainha.parar();
  campainha = processarPendentes(ow, db);
  log("campainha.renovada", { nome: "sorteios" });
}, RENOVAR_CAMPAINHA_MS);

let parando = false;
async function parar(sinal: string) {
  if (parando) return;
  parando = true;
  log("worker.parando", { sinal });
  clearInterval(watchdog);
  campainha.parar();
  await worker.stop();
  log("worker.parado", {});
  process.exit(0);
}
process.on("SIGTERM", () => void parar("SIGTERM"));
process.on("SIGINT", () => void parar("SIGINT"));
