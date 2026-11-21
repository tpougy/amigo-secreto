// "Apagar minha conta": o plano (função pura) do que o worker faz. A tela de conta usa o mesmo
// plano para dizer à pessoa o que vai acontecer; o workflow `apagar-conta` o executa.

/** Apelido que substitui o da pessoa nas participações que ficam (grupos já sorteados). */
export const APELIDO_REMOVIDO = "Participante removido";

export type ParticipacaoConta = {
  participanteId: string;
  grupoId: string;
  /** `status` do grupo: `aberto` com `rodadaAtual >= 1` é um grupo reaberto (sem pares). */
  status: string;
  /** `rodadaAtual` do grupo: >= 1 fora de `aberto` quer dizer que há sorteio (inclusive se encerrado depois). */
  rodadaAtual: number;
  /** `rodadaBase` do grupo (rodada em que foi reaberto); ausente vale 0. */
  rodadaBase?: number | null;
  /** Ids das respostas desta participação. */
  respostas: string[];
};

export type DadosConta = {
  usuarioId: string;
  participacoes: ParticipacaoConta[];
  /** Ids dos grupos que a pessoa organiza. */
  gruposOrganizados: string[];
};

export type OperacaoConta =
  /** Grupo já sorteado: a participação fica (os pares dos outros dependem dela), sem dados da pessoa. */
  | {
      tipo: "anonimizar";
      participanteId: string;
      grupoId: string;
      rodada: number;
      /** `rodadaBase` do grupo (0 se ausente): `rodada - rodadaBase` são as rodadas desta abertura. */
      rodadaBase: number;
      respostas: string[];
    }
  /** Grupo sem sorteio (ou reaberto, sem pares): a participação some (respostas e restrições vão em cascata). */
  | { tipo: "apagar-participacao"; participanteId: string; grupoId: string }
  /** Grupo que a pessoa organiza: some inteiro, para todos (cascata), com a capa. */
  | { tipo: "apagar-grupo"; grupoId: string }
  | { tipo: "concluir-pedido" }
  | { tipo: "apagar-usuario"; usuarioId: string };

/** Há pares em vigor (ou houve, num grupo encerrado): grupo reaberto (`aberto`) não conta. */
const temSorteio = (p: ParticipacaoConta) => p.status !== "aberto" && p.rodadaAtual >= 1;

const porId = <T>(f: (x: T) => string) => (a: T, b: T) => f(a).localeCompare(f(b));

/**
 * Ordem: anonimizar (grupos sorteados) → apagar participações (grupos sem sorteio ou reabertos) → apagar os
 * grupos organizados → concluir o pedido → apagar o `$users`. Participações em grupos que a
 * pessoa organiza não geram operação própria: somem com o grupo.
 */
export function planoApagarConta(d: DadosConta): OperacaoConta[] {
  const organizados = new Set(d.gruposOrganizados);
  const restantes = d.participacoes
    .filter((p) => !organizados.has(p.grupoId))
    .sort(porId((p) => p.participanteId));
  const ops: OperacaoConta[] = [];
  for (const p of restantes) {
    if (temSorteio(p)) {
      ops.push({
        tipo: "anonimizar",
        participanteId: p.participanteId,
        grupoId: p.grupoId,
        rodada: p.rodadaAtual,
        rodadaBase: p.rodadaBase ?? 0,
        respostas: [...p.respostas].sort(),
      });
    }
  }
  for (const p of restantes) {
    if (!temSorteio(p)) ops.push({ tipo: "apagar-participacao", participanteId: p.participanteId, grupoId: p.grupoId });
  }
  for (const g of [...organizados].sort()) ops.push({ tipo: "apagar-grupo", grupoId: g });
  ops.push({ tipo: "concluir-pedido" }, { tipo: "apagar-usuario", usuarioId: d.usuarioId });
  return ops;
}

/** Contagens do plano (para a confirmação na tela e para o log do worker). */
export function resumoPlano(ops: OperacaoConta[]): {
  anonimizadas: number;
  semRefazer: number;
  apagadas: number;
  grupos: number;
} {
  return {
    anonimizadas: ops.filter((o) => o.tipo === "anonimizar").length,
    // Grupos que já fizeram as 3 rodadas desta abertura: não dá para refazer, quem tirou a pessoa fica sem par.
    semRefazer: ops.filter((o) => o.tipo === "anonimizar" && o.rodada - o.rodadaBase >= 3).length,
    apagadas: ops.filter((o) => o.tipo === "apagar-participacao").length,
    grupos: ops.filter((o) => o.tipo === "apagar-grupo").length,
  };
}

/** Caminho da capa de um grupo no storage do Instant (`$files.path`). */
export function caminhoCapa(grupoId: string): string {
  return `grupos/${grupoId}/capa.jpg`;
}
