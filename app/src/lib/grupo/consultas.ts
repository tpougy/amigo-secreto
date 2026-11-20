// Consulta da página do grupo e funções puras que leem o resultado (testadas em consultas.test.ts).
import { limparRespostas, type DefCampo, type TipoCampo, type ValorResposta } from "@amigo/dominio";

/**
 * Tudo que a página do grupo precisa, numa consulta só. As regras do Instant recortam o resto:
 * - `organizador` só aparece para o próprio organizador (`$users.view`);
 * - `restricoes` só para o organizador;
 * - `participantes` (raiz) é o MEU participante; `doando` é o meu par (pares: só o doador vê),
 *   e as respostas do receptor só são visíveis para quem o tirou.
 */
export function consultaGrupo(grupoId: string, usuarioId: string) {
  return {
    grupos: {
      $: { where: { id: grupoId } },
      organizador: {},
      campos: {},
      participantes: {},
      restricoes: { participanteA: {}, participanteB: {} },
      sorteios: {},
    },
    participantes: {
      $: { where: { "usuario.id": usuarioId, "grupo.id": grupoId, removido: false } },
      respostas: { campo: {} },
      doando: { sorteio: {}, receptor: { respostas: { campo: {} } } },
    },
  };
}

export type CampoBruto = {
  id: string;
  rotulo: string;
  ajuda?: string | null;
  tipo: string;
  opcoes?: unknown;
  obrigatorio: boolean;
  ordem: number;
};

export function paraDefCampos(campos: CampoBruto[]): DefCampo[] {
  return campos
    .map((c) => ({
      id: c.id,
      rotulo: c.rotulo,
      ajuda: c.ajuda ?? undefined,
      tipo: c.tipo as TipoCampo,
      opcoes: Array.isArray(c.opcoes) ? (c.opcoes as string[]) : undefined,
      obrigatorio: c.obrigatorio,
      ordem: c.ordem,
    }))
    .sort((a, b) => a.ordem - b.ordem);
}

export type SorteioBruto = {
  id: string;
  status: string;
  rodada: number;
  erro?: string | null;
  criadoEm: string | number;
  concluidoEm?: string | number | null;
};

export type EstadoPainel =
  /** Nenhum sorteio concluído e nada em andamento nem com erro. */
  | { tipo: "nunca" }
  /** Pedido `pendente` ou `processando`. */
  | { tipo: "andamento"; sorteio: SorteioBruto }
  /** O último pedido (rodada ainda não concluída) falhou. */
  | { tipo: "erro"; sorteio: SorteioBruto; concluido: SorteioBruto | null }
  /** Rodada atual concluída (o último pedido deu certo). */
  | { tipo: "concluido"; sorteio: SorteioBruto | null };

const ms = (d: string | number | null | undefined) => (d == null ? 0 : new Date(d).getTime());

/** O pedido mais recente (por criação). */
export function ultimoSorteio(sorteios: SorteioBruto[]): SorteioBruto | null {
  return [...sorteios].sort((a, b) => ms(b.criadoEm) - ms(a.criadoEm))[0] ?? null;
}

/** O sorteio concluído da rodada atual (o que vale agora). */
export function sorteioVigente(sorteios: SorteioBruto[], rodadaAtual: number): SorteioBruto | null {
  if (rodadaAtual < 1) return null;
  return sorteios.find((s) => s.status === "concluido" && s.rodada === rodadaAtual) ?? null;
}

export function estadoPainel(rodadaAtual: number, sorteios: SorteioBruto[]): EstadoPainel {
  const ultimo = ultimoSorteio(sorteios);
  const vigente = sorteioVigente(sorteios, rodadaAtual);
  if (ultimo && (ultimo.status === "pendente" || ultimo.status === "processando")) {
    return { tipo: "andamento", sorteio: ultimo };
  }
  if (ultimo && ultimo.status === "erro" && ultimo.rodada > rodadaAtual) {
    return { tipo: "erro", sorteio: ultimo, concluido: vigente };
  }
  if (rodadaAtual >= 1) return { tipo: "concluido", sorteio: vigente };
  return { tipo: "nunca" };
}

/** Há um pedido de sorteio em andamento (a página avisa que o par pode mudar). */
export function emAndamento(sorteios: SorteioBruto[]): boolean {
  const u = ultimoSorteio(sorteios);
  return !!u && (u.status === "pendente" || u.status === "processando");
}

export type RespostaBruta = { valor: unknown; campo?: { id: string } | null };

/** Respostas válidas de um perfil, na ordem dos campos (o que "Você tirou" mostra). */
export function respostasVisiveis(
  campos: DefCampo[],
  respostas: RespostaBruta[],
): { campo: DefCampo; valor: ValorResposta }[] {
  const mapa: Record<string, unknown> = {};
  for (const r of respostas) if (r.campo) mapa[r.campo.id] = r.valor;
  const limpas = limparRespostas(campos, mapa);
  return campos.flatMap((c) => (c.id in limpas ? [{ campo: c, valor: limpas[c.id]! }] : []));
}

/** Id do usuário a partir da chave do participante (`<grupoId>:<userId>`): o organizador não vê o `$users` do membro. */
export function usuarioDaChave(chave: string): string | null {
  const i = chave.indexOf(":");
  return i > 0 && i < chave.length - 1 ? chave.slice(i + 1) : null;
}

export function dataBr(d: string | number | null | undefined): string | null {
  return d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : null;
}

/** `Date`/ISO do Instant → `YYYY-MM-DD` (para `<input type="date">`), no fuso de São Paulo. */
export function paraInputData(d: string | number | null | undefined): string {
  if (!d) return "";
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(d));
  return p;
}

export const rotuloStatusSorteio: Record<string, string> = {
  pendente: "Na fila",
  processando: "Sorteando",
  concluido: "Concluído",
  erro: "Erro",
};
