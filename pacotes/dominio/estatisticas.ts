// Contador público de grupos organizados (landing page). Só o worker (admin) conta e grava;
// ver worker/workflows/estatisticas.ts e a entidade `estatisticas` em pacotes/instant/schema.ts.

/** Id fixo do registro único de `estatisticas`. */
export const ESTATISTICAS_ID = "5e7a7157-0000-4000-8000-000000000001";

export type Contagem = { gruposOrganizados: number; contadoAte: number };

/**
 * Novo total a partir do anterior e das datas de criação (ms) dos grupos que existem agora.
 * O contador só sobe: grupos apagados não diminuem. Sem anterior, conta todos os existentes.
 * Depende só das entradas, então execuções simultâneas gravam o mesmo valor.
 */
export function atualizarContagem(anterior: Contagem | null, criadosEm: number[]): Contagem {
  const desde = anterior?.contadoAte ?? -Infinity;
  const novos = criadosEm.filter((t) => t > desde);
  return {
    gruposOrganizados: (anterior?.gruposOrganizados ?? 0) + novos.length,
    contadoAte: Math.max(anterior?.contadoAte ?? 0, ...novos),
  };
}

/** Grupos do e2e de produção (scripts/e2e-producao.ts) não contam. */
export function ehGrupoDeTeste(titulo: string): boolean {
  return titulo.startsWith("e2e-");
}

export function textoContador(n: number): { numero: string; rotulo: string } {
  return {
    numero: n.toLocaleString("pt-BR"),
    rotulo: n === 1 ? "amigo secreto já organizado" : "amigos secretos já organizados",
  };
}
