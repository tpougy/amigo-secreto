import { normalizarCodigo } from "@amigo/dominio";

// Decisão pura de para onde ir ao abrir `/g/<codigo>` (testável sem Svelte nem Instant).
export type EntradaNavegacao = {
  logado: boolean;
  grupo: null | { id: string; status: string };
  souMembro: boolean;
};

export type DestinoCodigo =
  | { tipo: "login" }
  | { tipo: "nao-encontrado" }
  | { tipo: "ir-para-grupo"; id: string }
  | { tipo: "ja-sorteado" }
  | { tipo: "encerrado" }
  | { tipo: "previa" };

export function destinoAoAbrirCodigo(e: EntradaNavegacao): DestinoCodigo {
  if (!e.logado) return { tipo: "login" };
  if (!e.grupo) return { tipo: "nao-encontrado" };
  if (e.souMembro) return { tipo: "ir-para-grupo", id: e.grupo.id };
  if (e.grupo.status === "sorteado") return { tipo: "ja-sorteado" };
  if (e.grupo.status === "encerrado") return { tipo: "encerrado" };
  return { tipo: "previa" };
}

/** Código contido num QR: uma URL `.../g/<CODIGO>` ou só o código. `null` se não for válido. */
export function codigoDeQR(texto: string): string | null {
  const t = texto.trim();
  const m = /\/g\/([^/?#\s]+)/.exec(t);
  return normalizarCodigo(m ? decodeURIComponent(m[1]!) : t);
}

export type ErroEntrada = { mensagem: string; irParaGrupo: boolean };

/** Traduz o erro do Instant ao tentar entrar num grupo. */
export function erroDeEntrada(e: unknown): ErroEntrada {
  const tipo = (e as { body?: { type?: string } } | null)?.body?.type;
  if (tipo === "rate-limited")
    return { mensagem: "Muitas tentativas. Tente de novo em alguns minutos", irParaGrupo: false };
  if (tipo === "record-not-unique") return { mensagem: "Você já está neste grupo", irParaGrupo: true };
  if (tipo === "permission-denied")
    return { mensagem: "Não foi possível entrar (o grupo pode estar fechado)", irParaGrupo: false };
  return { mensagem: "Algo deu errado. Tente de novo.", irParaGrupo: false };
}
