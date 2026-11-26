// Handler `reabertura`: da reabertura pedida pelo organizador ao grupo aberto de novo.
// O organizador não enxerga os pares (regra), então não consegue apagá-los: ele cria uma
// `reaberturas` com `sendCommand` e o worker, como admin, desfaz o sorteio.
// A biblioteca só chama o handler com o pedido aberto e grava `running`/`failed`; os passos
// guardam no ow.db só ids e contagens. `reaberturas.error` é visível aos membros do grupo:
// só as mensagens fixas abaixo (ou o `defaultErrorMessage`).
import * as ic from "instant-commands/worker";
import { reabertura } from "@amigo/instant/commands";
import { defineHandler, type Ctx } from "../commands";
import { log } from "../nucleo/log";
import { RETRY_PASSO_PADRAO, type AdminDb } from "./comum";

export const MSG_GRUPO_NAO_EXISTE = "O grupo não existe mais";
export const MSG_GRUPO_NAO_SORTEADO = "O grupo não está sorteado";
export const MSG_SORTEIO_EM_ANDAMENTO = "Há um sorteio em andamento";
export const MSG_PADRAO_REABERTURA = "Não foi possível reabrir o grupo. Tente de novo.";

type Comando = Ctx<typeof reabertura>["command"];

const aberto = (status: string | null | undefined) => status === "pending" || status === "running";

const FALHAS = {
  inexistente: { erro: MSG_GRUPO_NAO_EXISTE, codigo: "grupo-inexistente" },
  naoSorteado: { erro: MSG_GRUPO_NAO_SORTEADO, codigo: "grupo-nao-sorteado" },
  emAndamento: { erro: MSG_SORTEIO_EM_ANDAMENTO, codigo: "sorteio-em-andamento" },
} as const;

function motivoErro(g: { status: string; sorteios: { status: string }[] } | undefined) {
  if (!g) return FALHAS.inexistente;
  if (g.status !== "sorteado") return FALHAS.naoSorteado;
  if (g.sorteios.some((s) => aberto(s.status))) return FALHAS.emAndamento;
  return null;
}

/** Registra a falha de negócio no log e termina o pedido `failed` com a mensagem fixa. */
function falhar(reaberturaId: string, grupoId: string, f: (typeof FALHAS)[keyof typeof FALHAS]): never {
  log("reabertura.erro", { reaberturaId, grupoId, codigo: f.codigo });
  ic.fail(f.erro);
}

/**
 * Passo `carregar`: o grupo existe, está `sorteado` e não tem sorteio aberto. Reabertura que
 * sumiu (apagada em cascata com o grupo) → `{ ignorado }`: a biblioteca não escreve em pedido
 * apagado. Falha de negócio → `ic.fail`.
 */
export async function carregar(db: AdminDb, reaberturaId: string): Promise<{ ignorado: true } | { grupoId: string }> {
  const { reaberturas } = await db.query({
    reaberturas: { $: { where: { id: reaberturaId } }, grupo: { sorteios: {} } },
  });
  const r = reaberturas[0];
  if (!r) return { ignorado: true };
  const g = r.grupo;
  const falha = motivoErro(g);
  if (falha || !g) falhar(reaberturaId, g?.id ?? "", falha ?? FALHAS.inexistente);
  return { grupoId: g.id };
}

/**
 * Passo `reabrir`. Relê o estado no mesmo passo e escreve numa transação só:
 * - reabertura inexistente (apagada pelo organizador, ou em cascata com o grupo) ou já
 *   terminada (uma irmã a marcou `failed`) → `{ ignorado }`, sem escrita nenhuma (um `update`
 *   em id apagado recriaria a reabertura como fantasma);
 * - grupo inexistente, não `sorteado` ou com sorteio aberto → `ic.fail` (grupo e pares intocados);
 * - senão: apaga todos os pares do grupo, grava `aberto` e `rodadaBase = rodadaAtual`,
 *   `command.complete({ pares })` e marca as outras reaberturas abertas do grupo `failed`
 *   ("não está sorteado").
 * Reexecutar é seguro: depois de aplicado, a reabertura já não está aberta.
 */
export async function reabrir(db: AdminDb, command: Comando): Promise<{ ignorado: true } | { pares: number }> {
  const reaberturaId = command.id;
  const { reaberturas } = await db.query({
    reaberturas: { $: { where: { id: reaberturaId } }, grupo: { sorteios: { pares: {} }, reaberturas: {} } },
  });
  const r = reaberturas[0];
  if (!r || !aberto(r.status)) return { ignorado: true };
  const g = r.grupo;

  const falha = motivoErro(g);
  if (falha || !g) falhar(reaberturaId, g?.id ?? "", falha ?? FALHAS.inexistente);

  // Uma leitura só: os pares do grupo são os pares de todos os sorteios dele.
  const pares = g.sorteios.flatMap((s) => s.pares);
  // As outras reaberturas abertas do grupo (duplo clique) terminam aqui, na mesma transação:
  // se uma delas ficasse aberta (retry longo) até depois de um sorteio novo, encontraria o
  // grupo `sorteado` e apagaria os pares novos. Assim, quando o run dela chega, é pulado.
  const irmas = g.reaberturas.filter((x) => x.id !== reaberturaId && aberto(x.status));
  await db.transact([
    ...pares.map((p) => db.tx.pares[p.id]!.delete()),
    db.tx.grupos[g.id]!.update({ status: "aberto", rodadaBase: g.rodadaAtual }),
    command.complete({ pares: pares.length }),
    ...irmas.map((x) => ic.failCommand(reabertura, x.id, MSG_GRUPO_NAO_SORTEADO)),
  ]);
  for (const x of irmas) log("reabertura.erro", { reaberturaId: x.id, grupoId: g.id, codigo: "grupo-nao-sorteado" });
  log("reabertura.concluida", { reaberturaId, grupoId: g.id, pares: pares.length });
  return { pares: pares.length };
}

/**
 * O handler da `reabertura` (versão "1"). `retryPolicy` só é sobrescrita pelos testes, para
 * forçar uma falha rápida.
 */
export function criarReaberturaHandler(opcoes: { retryPolicy?: ic.RetryPolicy } = {}) {
  return defineHandler(
    reabertura,
    async ({ db, command, step }) => {
      const carga = await step.run("carregar", carregar, db, command.id);
      if ("ignorado" in carga) return;
      // `{ ignorado }` aqui: o pedido sumiu ou já terminou; a biblioteca não o sobrescreve.
      await step.run("reabrir", reabrir, db, command);
    },
    {
      version: "1",
      retryPolicy: opcoes.retryPolicy ?? RETRY_PASSO_PADRAO,
      defaultErrorMessage: MSG_PADRAO_REABERTURA,
    },
  );
}
