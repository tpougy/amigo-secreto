// Regras puras da página do grupo (sorteio, refazer, banner). Testadas em regras.test.ts.

/** No máximo 3 rodadas de sorteio por abertura do grupo (reabrir zera a contagem). */
export const LIMITE_RODADAS = 3;
/** Mínimo de participantes ativos (não removidos) para sortear. */
export const MINIMO_ATIVOS = 3;

export type ParticipanteRegra = {
  removido: boolean;
  viuParNaRodada?: number | null;
  removidoNaRodada?: number | null;
};

/**
 * Rodadas sorteadas desde a última abertura: `rodadaAtual − rodadaBase`. Reabrir grava
 * `rodadaBase = rodadaAtual`; grupos antigos não têm `rodadaBase` (vale 0).
 */
export function rodadasNestaAbertura(g: { rodadaAtual: number; rodadaBase?: number | null }): number {
  return g.rodadaAtual - (g.rodadaBase ?? 0);
}

export type EntradaRefazer = {
  rodadaAtual: number;
  rodadaBase?: number | null;
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
  if (rodadasNestaAbertura(e) >= LIMITE_RODADAS) return { permitido: false, motivo: "Limite de 3 sorteios atingido" };
  if (e.ativos < MINIMO_ATIVOS) return { permitido: false, motivo: "São necessários pelo menos 3 participantes" };
  if (e.viram <= 0) return { permitido: true, nivel: "simples", texto: "Refazer o sorteio? Ninguém viu o resultado ainda." };
  return {
    permitido: true,
    nivel: "forte",
    texto: `${e.viram} pessoa(s) já viram quem tiraram. Refazer troca os pares de todos.`,
  };
}

/** Palavra que o organizador digita na confirmação forte de reabrir. */
export const PALAVRA_REABRIR = "REABRIR";

/** Confirmação de "Reabrir grupo para novos participantes": forte se alguém já viu o par. */
export function confirmacaoReabrir(e: { viram: number }): { nivel: "simples" | "forte"; texto: string } {
  if (e.viram <= 0) return { nivel: "simples", texto: "Reabrir desfaz o sorteio. Ninguém viu o resultado ainda." };
  return { nivel: "forte", texto: `${e.viram} pessoa(s) já viram quem tiraram. Reabrir desfaz o sorteio de todos.` };
}

/** Aviso ao participante quando o organizador reabre o grupo. */
export const AVISO_DESFEITO = "O sorteio foi desfeito pelo organizador para incluir mais gente. Aguarde o novo sorteio.";

/**
 * O que o topo da página mostra ao participante:
 * - `desfeito`: o grupo foi reaberto depois de um sorteio (aberto com rodada > 0);
 * - `tirou`: tenho par na rodada atual;
 * - `fora`: grupo sorteado e eu sem par;
 * - `aguardando`: ainda não houve sorteio.
 */
export function estadoParaParticipante(
  g: { status: string; rodadaAtual: number },
  temPar: boolean,
): "aguardando" | "desfeito" | "tirou" | "fora" {
  if (g.status === "aberto" && g.rodadaAtual > 0) return "desfeito";
  if (temPar) return "tirou";
  if (g.status === "sorteado" && g.rodadaAtual >= 1) return "fora";
  return "aguardando";
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

/**
 * Texto da confirmação de remoção pelo organizador (antes/depois do sorteio, e sem refazer).
 * Com o grupo reaberto (`aberto`), não há pares: vale o texto de antes do sorteio.
 */
export function textoRemocao(rodadaAtual: number, rodadaBase?: number | null, status?: string): string {
  if (rodadaAtual < 1 || status === "aberto") return "A pessoa sai do grupo e as respostas do perfil dela são apagadas.";
  if (rodadasNestaAbertura({ rodadaAtual, rodadaBase }) >= LIMITE_RODADAS) {
    return (
      "O limite de 3 sorteios foi atingido: o sorteio não pode mais ser refeito. " +
      "Quem tirou essa pessoa fica sem amigo secreto (a corrente se quebra). " +
      "As respostas do perfil dela serão apagadas."
    );
  }
  return "Remover depois do sorteio exige refazer o sorteio. As respostas do perfil dessa pessoa serão apagadas.";
}

/** Texto do banner "alguém saiu depois do sorteio" (sem convite a refazer quando não dá mais). */
export function textoBannerRemovido(rodadaAtual: number, rodadaBase?: number | null): string {
  if (rodadasNestaAbertura({ rodadaAtual, rodadaBase }) >= LIMITE_RODADAS) {
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
