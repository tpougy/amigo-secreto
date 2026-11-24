// Workflow `limpar-historico`: o OpenWorkflow 0.11 não tem retenção (issue #303), então o worker
// apaga do próprio ow.db os runs encerrados há mais de RETENCAO_DIAS. Agendado todo dia às 05:00,
// depois dos backups (03:00/03:30) e da imagem da Hospede Aqui (04:30).
// Padrão em vps/docs/plataforma-workflows.md ("Limpeza do histórico").
import { Database } from "bun:sqlite";
import { defineWorkflowSpec, type OpenWorkflow } from "openworkflow";
import { log } from "../nucleo/log";

export const RETENCAO_DIAS = 30;
export const CRON_LIMPEZA = "0 5 * * *";
const DIA_MS = 24 * 60 * 60 * 1000;

/** Status finais de um run (core/workflow-run.d.ts da 0.11; `succeeded` é legado). */
const ENCERRADOS = ["succeeded", "completed", "failed", "canceled"];

/** Sem `version`: o OpenWorkflow 0.11 recusa agendamento recorrente de workflow versionado. */
export const specLimpar = defineWorkflowSpec<null, { apagados: number }>({
  name: "limpar-historico",
  retryPolicy: { maximumAttempts: 1 },
});

/**
 * Apaga os runs encerrados antes de `agora - dias`. Os `step_attempts` caem junto
 * (ON DELETE CASCADE, com `foreign_keys` ligado nesta conexão). Datas no ow.db são texto ISO.
 * Devolve quantos runs apagou.
 */
export function apagarEncerrados(caminhoDb: string, agora: Date, dias: number): number {
  const corte = new Date(agora.getTime() - dias * DIA_MS).toISOString();
  const sql = new Database(caminhoDb);
  try {
    sql.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    const r = sql.run(
      `DELETE FROM workflow_runs
        WHERE status IN (${ENCERRADOS.map(() => "?").join(", ")}) AND finished_at < ?`,
      [...ENCERRADOS, corte],
    );
    return r.changes;
  } finally {
    sql.close();
  }
}

/** Registra o workflow e o agendamento diário (último a declarar vence; idempotente a cada boot). */
export async function definirLimpeza(ow: OpenWorkflow, caminhoDb: string, dias = RETENCAO_DIAS) {
  const wf = ow.defineWorkflow(specLimpar, ({ step }) =>
    step.run({ name: "apagar-encerrados" }, () => {
      const apagados = apagarEncerrados(caminhoDb, new Date(), dias);
      log("historico.limpo", { apagados, dias });
      return { apagados };
    }),
  );
  await ow.scheduleWorkflow(specLimpar, null, { cron: CRON_LIMPEZA, timezone: "America/Sao_Paulo" });
  return wf;
}
