// Regras de edição do grupo e dos campos do perfil, compartilhadas pelo app (criar/configurações)
// e pelo MCP (ferramentas do organizador). Mensagens em pt-BR, prontas para mostrar.
import type { TipoCampo } from "./campos";

export const TIPOS_CAMPO = ["texto-curto", "texto-longo", "lista", "multipla", "unica"] as const satisfies readonly TipoCampo[];

/** `multipla` e `unica` escolhem entre opções. */
export function temOpcoes(tipo: string): boolean {
  return tipo === "multipla" || tipo === "unica";
}

export type DadosGrupo = {
  titulo: string;
  descricao: string;
  /** `AAAA-MM-DD` ou vazio. */
  dataSorteio: string;
  /** `AAAA-MM-DD` ou vazio. */
  dataEvento: string;
  /** `null` = sem valor; `NaN` = digitado inválido. */
  valor: number | null;
};

export function validarTituloDescricao(d: Pick<DadosGrupo, "titulo" | "descricao">): string[] {
  const erros: string[] = [];
  const t = d.titulo.trim().length;
  if (t < 3 || t > 80) erros.push("O título precisa ter de 3 a 80 caracteres.");
  if (d.descricao.trim().length > 500) erros.push("A descrição pode ter no máximo 500 caracteres.");
  return erros;
}

export function validarDatasValor(d: Pick<DadosGrupo, "dataSorteio" | "dataEvento" | "valor">): string[] {
  const erros: string[] = [];
  if (d.dataSorteio && d.dataEvento && d.dataEvento < d.dataSorteio) {
    erros.push("A data do evento não pode ser anterior à data prevista do sorteio.");
  }
  if (d.valor !== null && (Number.isNaN(d.valor) || d.valor < 0)) {
    erros.push("O valor sugerido precisa ser um número maior ou igual a 0.");
  }
  return erros;
}

export function validarDadosGrupo(d: DadosGrupo): string[] {
  return [...validarTituloDescricao(d), ...validarDatasValor(d)];
}

export function validarCamposEditados(campos: { rotulo: string; tipo: string; opcoes: string[] }[]): string[] {
  const erros: string[] = [];
  campos.forEach((c, i) => {
    const nome = `Campo ${i + 1}`;
    if (c.rotulo.trim() === "") erros.push(`${nome}: informe o rótulo.`);
    if (temOpcoes(c.tipo) && c.opcoes.map((o) => o.trim()).filter(Boolean).length < 2) {
      erros.push(`${nome}${c.rotulo.trim() ? ` (${c.rotulo.trim()})` : ""}: informe pelo menos 2 opções.`);
    }
  });
  return erros;
}

/** `AAAA-MM-DD` → ISO ao meio-dia (evita trocar de dia por fuso). */
export function diaParaIso(dia: string): string {
  return new Date(`${dia}T12:00:00`).toISOString();
}

/** Data gravada (ISO ou epoch) → `AAAA-MM-DD` no fuso de São Paulo; vazio se não houver. */
export function isoParaDia(d: string | number | Date | null | undefined): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(d));
}
