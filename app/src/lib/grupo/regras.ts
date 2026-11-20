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

/** Texto da confirmação de remoção pelo organizador (antes/depois do sorteio, e sem refazer). */
export function textoRemocao(rodadaAtual: number): string {
  if (rodadaAtual < 1) return "A pessoa sai do grupo e as respostas do perfil dela são apagadas.";
  if (rodadaAtual >= LIMITE_RODADAS) {
    return (
      "O limite de 3 sorteios foi atingido: o sorteio não pode mais ser refeito. " +
      "Quem tirou essa pessoa fica sem amigo secreto (a corrente se quebra). " +
      "As respostas do perfil dela serão apagadas."
    );
  }
  return "Remover depois do sorteio exige refazer o sorteio. As respostas do perfil dessa pessoa serão apagadas.";
}

/** Texto do banner "alguém saiu depois do sorteio" (sem convite a refazer quando não dá mais). */
export function textoBannerRemovido(rodadaAtual: number): string {
  if (rodadaAtual >= LIMITE_RODADAS) {
    return "Um participante saiu depois do sorteio. O limite de 3 sorteios foi atingido: quem tirou essa pessoa ficou sem amigo secreto.";
  }
  return "Um participante saiu depois do sorteio. Refaça o sorteio para incluir todos corretamente.";
}

/**
 * Grupo sorteado e eu (participante ativo) sem par na rodada atual: entrei, ou o sorteio rodou sem
 * mim. Não vale durante um sorteio em andamento (o par está para mudar).
 */
export function foraDoSorteio(e: {
  status: string;
  rodadaAtual: number;
  souParticipanteAtivo: boolean;
  temPar: boolean;
  andamento: boolean;
}): boolean {
  return e.status === "sorteado" && e.rodadaAtual >= 1 && e.souParticipanteAtivo && !e.temPar && !e.andamento;
}
