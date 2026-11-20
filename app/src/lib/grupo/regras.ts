// Regras puras da página do grupo (sorteio, refazer, banner). Testadas em regras.test.ts.

/** No máximo 3 rodadas de sorteio concluídas por grupo. */
export const LIMITE_RODADAS = 3;
/** Mínimo de participantes ativos (não removidos) para sortear. */
export const MINIMO_ATIVOS = 3;

export type ParticipanteRegra = {
  removido: boolean;
  viuParNaRodada?: number | null;
  removidoNaRodada?: number | null;
};

export type EntradaRefazer = {
  rodadaAtual: number;
  ativos: number;
  viram: number;
  /** Há participante removido depois do sorteio atual (a UI muda o título do diálogo). */
  removidoAposSorteio: boolean;
};

export type Confirmacao =
  | { permitido: false; motivo: string }
  | { permitido: true; nivel: "simples" | "forte"; texto: string };

/** Palavra que o organizador digita na confirmação forte. */
export const PALAVRA_REFAZER = "REFAZER";

export function confirmacaoRefazer(e: EntradaRefazer): Confirmacao {
  if (e.rodadaAtual >= LIMITE_RODADAS) return { permitido: false, motivo: "Limite de 3 sorteios atingido" };
  if (e.ativos < MINIMO_ATIVOS) return { permitido: false, motivo: "São necessários pelo menos 3 participantes" };
  if (e.viram <= 0) return { permitido: true, nivel: "simples", texto: "Refazer o sorteio? Ninguém viu o resultado ainda." };
  return {
    permitido: true,
    nivel: "forte",
    texto: `${e.viram} pessoa(s) já viram quem tiraram. Refazer troca os pares de todos.`,
  };
}

/** Participantes não removidos que já abriram o par da rodada atual. */
export function contarViram(participantes: ParticipanteRegra[], rodadaAtual: number): number {
  if (rodadaAtual < 1) return 0;
  return participantes.filter((p) => !p.removido && p.viuParNaRodada === rodadaAtual).length;
}

export function contarAtivos(participantes: ParticipanteRegra[]): number {
  return participantes.filter((p) => !p.removido).length;
}

/** Por que o botão Sortear está desabilitado (ou `null` se pode sortear). */
export function motivoNaoSortear(ativos: number): string | null {
  return ativos < MINIMO_ATIVOS ? "São necessários pelo menos 3 participantes" : null;
}

/**
 * Banner "Um participante saiu depois do sorteio": grupo sorteado e alguém removido NA rodada atual.
 * Depois de refazer, `rodadaAtual` avança e o banner some (removidos de rodadas antigas não contam).
 */
export function bannerRemovidoAposSorteio(
  status: string,
  rodadaAtual: number,
  participantes: ParticipanteRegra[],
): boolean {
  if (status !== "sorteado" || rodadaAtual < 1) return false;
  return participantes.some((p) => p.removido && p.removidoNaRodada === rodadaAtual);
}
