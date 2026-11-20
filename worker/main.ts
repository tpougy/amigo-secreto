// Processo principal do worker: OpenWorkflow (SQLite) + campainha do Instant.
// Env: SORTEIO_SEGREDO, INSTANT_APP_ID, INSTANT_ADMIN_TOKEN, INSTANT_API_URI, OW_DB (/data/ow.db),
// OW_CONCORRENCIA (2).
import { init } from "@instantdb/admin";
import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";
import schema from "../instant.schema";
import { log } from "./nucleo/log";
import { validarSegredo } from "./nucleo/seed";
import { definirApagarConta, processarPedidosExclusao } from "./workflows/apagarConta";
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

// Segredo da seed do sorteio (ver nucleo/seed.ts). Sem ele, o worker não sobe: sortear com uma
// seed previsível exporia os pares.
let segredo: string;
try {
  segredo = validarSegredo(process.env.SORTEIO_SEGREDO);
} catch (e) {
  log("worker.segredo_invalido", { motivo: (e as Error).message });
  process.exit(1);
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
definirSorteio(ow, db, { segredo });
definirApagarConta(ow, db);

const worker = ow.newWorker({ concurrency: concorrencia });
await worker.start();
log("worker.iniciado", { concorrencia, pid: process.pid });

// Uma campainha por fila: sorteios pendentes e pedidos de exclusão de conta.
const filas = [
  { nome: "sorteios", abrir: () => processarPendentes(ow, db) },
  { nome: "pedidosExclusao", abrir: () => processarPedidosExclusao(ow, db) },
];
let campainhas = filas.map((f) => f.abrir());
const watchdog = setInterval(() => {
  for (const c of campainhas) c.parar();
  campainhas = filas.map((f) => f.abrir());
  for (const f of filas) log("campainha.renovada", { nome: f.nome });
}, RENOVAR_CAMPAINHA_MS);

let parando = false;
async function parar(sinal: string) {
  if (parando) return;
  parando = true;
  log("worker.parando", { sinal });
  clearInterval(watchdog);
  for (const c of campainhas) c.parar();
  await worker.stop();
  log("worker.parado", {});
  process.exit(0);
}
process.on("SIGTERM", () => void parar("SIGTERM"));
process.on("SIGINT", () => void parar("SIGINT"));
