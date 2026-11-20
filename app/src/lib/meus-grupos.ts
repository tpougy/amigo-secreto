// Separação "Organizando" / "Participando" (função pura, testada com bun test).

export type StatusGrupo = "aberto" | "sorteado" | "encerrado";

export interface GrupoResumo {
  id: string;
  titulo: string;
  status: string;
  criadoEm?: string | number | Date;
  /** Link `grupos.capa` ($files); ver `urlCapa`. */
  capa?: unknown;
}

export interface ParticipacaoResumo {
  removido: boolean;
  grupo?: GrupoResumo | null;
}

export interface MeusGrupos {
  organizando: GrupoResumo[];
  participando: GrupoResumo[];
}

function quando(g: GrupoResumo): number {
  const t = g.criadoEm === undefined ? NaN : new Date(g.criadoEm).getTime();
  return Number.isNaN(t) ? 0 : t;
}

const maisRecentePrimeiro = (a: GrupoResumo, b: GrupoResumo) => quando(b) - quando(a);

/**
 * Organizando = grupos em que sou o organizador.
 * Participando = grupos com participação minha não removida, exceto os que organizo
 * (o organizador também participa, mas aparece uma vez só).
 */
export function separarGrupos(
  organizados: GrupoResumo[],
  participacoes: ParticipacaoResumo[],
): MeusGrupos {
  const idsOrganizados = new Set(organizados.map((g) => g.id));
  const vistos = new Set<string>();
  const participando: GrupoResumo[] = [];
  for (const p of participacoes) {
    const g = p.grupo;
    if (p.removido || !g || idsOrganizados.has(g.id) || vistos.has(g.id)) continue;
    vistos.add(g.id);
    participando.push(g);
  }
  return {
    organizando: [...organizados].sort(maisRecentePrimeiro),
    participando: participando.sort(maisRecentePrimeiro),
  };
}

export const rotuloStatus: Record<StatusGrupo, string> = {
  aberto: "Aberto",
  sorteado: "Sorteado",
  encerrado: "Encerrado",
};

export function ehStatus(s: string): s is StatusGrupo {
  return s === "aberto" || s === "sorteado" || s === "encerrado";
}
