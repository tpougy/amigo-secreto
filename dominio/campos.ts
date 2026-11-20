import { z } from "zod";

export type TipoCampo = "texto-curto" | "texto-longo" | "lista" | "multipla" | "unica";

export type DefCampo = {
  id: string;
  rotulo: string;
  ajuda?: string;
  tipo: TipoCampo;
  opcoes?: string[];
  obrigatorio: boolean;
  ordem: number;
};

export type ValorResposta = string | string[];

export type ResultadoValidacao =
  | { ok: true; valor: ValorResposta }
  | { ok: false; erro: string };

const MAX_CURTO = 120;
const MAX_LONGO = 2000;
const MAX_ITENS = 30;

const textoCurto = z.string().trim().max(MAX_CURTO, `Máximo de ${MAX_CURTO} caracteres`);
const textoLongo = z.string().trim().max(MAX_LONGO, `Máximo de ${MAX_LONGO} caracteres`);
const lista = z
  .array(z.string().trim().max(MAX_CURTO, `Cada item pode ter no máximo ${MAX_CURTO} caracteres`))
  .transform((itens) => itens.filter((i) => i !== ""))
  .pipe(z.array(z.string()).max(MAX_ITENS, `Máximo de ${MAX_ITENS} itens`));

function primeiroErro(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Valor inválido";
}

export function validarResposta(campo: DefCampo, valor: unknown): ResultadoValidacao {
  const opcoes = campo.opcoes ?? [];
  let r;
  switch (campo.tipo) {
    case "texto-curto":
      r = textoCurto.safeParse(valor);
      break;
    case "texto-longo":
      r = textoLongo.safeParse(valor);
      break;
    case "lista":
      r = lista.safeParse(valor);
      break;
    case "multipla": {
      const arr = z.array(z.string()).safeParse(valor);
      if (!arr.success) return { ok: false, erro: "Valor inválido" };
      if (arr.data.some((o) => !opcoes.includes(o))) return { ok: false, erro: "Opção inválida" };
      return { ok: true, valor: [...new Set(arr.data)] };
    }
    case "unica": {
      const s = z.string().safeParse(valor);
      if (!s.success) return { ok: false, erro: "Valor inválido" };
      if (!opcoes.includes(s.data)) return { ok: false, erro: "Opção inválida" };
      return { ok: true, valor: s.data };
    }
    default:
      return { ok: false, erro: "Tipo de campo desconhecido" };
  }
  return r.success ? { ok: true, valor: r.data } : { ok: false, erro: primeiroErro(r.error) };
}

function vazio(v: ValorResposta): boolean {
  return typeof v === "string" ? v === "" : v.length === 0;
}

/** Remove de um valor bruto as opções que deixaram de existir no campo. */
function podarOpcoes(campo: DefCampo, valor: unknown): unknown {
  const opcoes = campo.opcoes ?? [];
  if (campo.tipo === "multipla" && Array.isArray(valor)) {
    return valor.filter((o) => typeof o === "string" && opcoes.includes(o));
  }
  return valor;
}

/** Descarta campos inexistentes, opções removidas e valores inválidos ou vazios. Nunca lança. */
export function limparRespostas(
  campos: DefCampo[],
  respostas: Record<string, unknown>,
): Record<string, ValorResposta> {
  const saida: Record<string, ValorResposta> = {};
  for (const campo of campos) {
    if (!Object.hasOwn(respostas, campo.id)) continue;
    const r = validarResposta(campo, podarOpcoes(campo, respostas[campo.id]));
    if (r.ok && !vazio(r.valor)) saida[campo.id] = r.valor;
  }
  return saida;
}

/** Verdadeiro se todos os campos obrigatórios têm resposta válida e não vazia. */
export function perfilCompleto(campos: DefCampo[], respostas: Record<string, unknown>): boolean {
  const limpas = limparRespostas(campos, respostas);
  return campos.every((c) => !c.obrigatorio || c.id in limpas);
}
