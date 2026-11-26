// Workflow `atualizar-estatisticas`: conta os grupos organizados e grava o registro público
// `estatisticas` (lido pela landing). Agendado a cada hora e disparado uma vez ao iniciar.
// A conta é `atualizarContagem` (@amigo/dominio): só sobe e é idempotente.
import { defineWorkflowSpec, type OpenWorkflow } from "openworkflow";
import { atualizarContagem, ehGrupoDeTeste, ESTATISTICAS_ID, type Contagem } from "@amigo/dominio";
import { log } from "../nucleo/log";
import type { AdminDb } from "../handlers/comum";

export const CRON_ESTATISTICAS = "0 * * * *";

/** Sem `version`: o OpenWorkflow 0.11 recusa agendamento recorrente de workflow versionado. */
export const specEstatisticas = defineWorkflowSpec<null, Contagem>({
  name: "atualizar-estatisticas",
  retryPolicy: { maximumAttempts: 3 },
});

const ms = (d: string | number | Date) => new Date(d).getTime();

/** Lê o registro e os grupos, calcula o novo total e grava. `registroId` muda só nos testes. */
export async function contarGrupos(db: AdminDb, registroId = ESTATISTICAS_ID): Promise<Contagem> {
  const { grupos, estatisticas } = await db.query({
    grupos: {},
    estatisticas: { $: { where: { id: registroId } } },
  });
  const atual = estatisticas[0];
  const anterior = atual ? { gruposOrganizados: atual.gruposOrganizados, contadoAte: ms(atual.contadoAte) } : null;
  const criadosEm = grupos.filter((g) => !ehGrupoDeTeste(g.titulo)).map((g) => ms(g.criadoEm));
  const nova = atualizarContagem(anterior, criadosEm);
  await db.transact(db.tx.estatisticas[registroId]!.update({ ...nova, atualizadoEm: Date.now() }));
  return nova;
}

/** Registra o workflow, o agendamento de hora em hora e dispara uma contagem agora. */
export async function definirEstatisticas(ow: OpenWorkflow, db: AdminDb) {
  const wf = ow.defineWorkflow(specEstatisticas, ({ step }) =>
    step.run({ name: "contar" }, async () => {
      const r = await contarGrupos(db);
      log("estatisticas.atualizadas", r);
      return r;
    }),
  );
  await ow.scheduleWorkflow(specEstatisticas, null, { cron: CRON_ESTATISTICAS, timezone: "America/Sao_Paulo" });
  try {
    await ow.runWorkflow(specEstatisticas, null);
  } catch (e) {
    log("estatisticas.disparo_falhou", { motivo: (e as Error).message });
  }
  return wf;
}
