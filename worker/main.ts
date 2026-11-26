// Processo principal do worker: OpenWorkflow (SQLite) + runner do instant-commands (assinatura).
// Env: SORTEIO_SEGREDO, INSTANT_APP_ID, INSTANT_ADMIN_TOKEN, INSTANT_API_URI, OW_DB (/data/ow.db),
// OW_CONCORRENCIA (2).
import { init } from "@instantdb/admin";
import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";
import schema from "@amigo/instant";
import { log } from "./nucleo/log";
import { validarSegredo } from "./nucleo/seed";
import type { RunnerEvent } from "instant-commands/worker";
import { createRunner } from "./commands";
import { criarExclusaoContaHandler } from "./handlers/exclusaoConta";
import { criarReaberturaHandler } from "./handlers/reabertura";
import { aoFalharSorteio, criarSorteioHandler } from "./handlers/sorteio";
import { reprocessarExclusoes } from "./schedules/reprocessarExclusoes";
import { definirLimpeza } from "./workflows/limparHistorico";
import { definirEstatisticas } from "./workflows/estatisticas";

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
/** Campos escalares do evento (descarta undefined e listas), no formato do `log`. */
function logavel(e: RunnerEvent): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(e)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (Array.isArray(v)) out[k] = v.join(",");
  }
  return out;
}

const concorrencia = Number(process.env.OW_CONCORRENCIA ?? "2") || 2;

const owDb = process.env.OW_DB ?? "/data/ow.db";
const backend = BackendSqlite.connect(owDb);
const ow = new OpenWorkflow({ backend });
// Workflows simples (sem command): registrados no `ow` antes de `runner.start()`, que sobe o worker.
await definirLimpeza(ow, owDb); // runs encerrados há mais de 30 dias, todo dia às 05:00
await definirEstatisticas(ow, db); // contador público da landing: de hora em hora e uma vez agora

const runner = createRunner({
  ow,
  db,
  handlers: [criarSorteioHandler({ segredo }), criarReaberturaHandler(), criarExclusaoContaHandler()],
  schedules: [reprocessarExclusoes],
  trigger: { type: "subscription" },
  concurrency: concorrencia,
  onEvent: (e) => {
    log(`ic.${e.type}`, logavel(e));
    if (e.type !== "command.failed") return;
    if (e.command === "sorteio" && e.commandId) {
      // Fase `erro` no stream de progresso. Best effort: nunca lança.
      try {
        aoFalharSorteio(db, e.commandId);
      } catch (err) {
        log("sorteio.stream_erro_falhou", { sorteioId: e.commandId, motivo: (err as Error).message });
      }
    } else if (e.command === "exclusao-conta") {
      log("exclusao.falhou", { pedidoId: e.commandId ?? "" });
    }
  },
});
await runner.start();
log("worker.iniciado", { concorrencia, pid: process.pid });

let parando = false;
async function parar(sinal: string) {
  if (parando) return;
  parando = true;
  log("worker.parando", { sinal });
  await runner.stop();
  log("worker.parado", {});
  process.exit(0);
}
process.on("SIGTERM", () => void parar("SIGTERM"));
process.on("SIGINT", () => void parar("SIGINT"));
