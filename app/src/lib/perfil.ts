// Lógica pura do formulário de perfil: valor inicial, limpeza e validação (testável com `bun test`).
import { validarResposta, type DefCampo, type ValorResposta } from "@amigo/dominio";

export type ValorBruto = string | string[];

/** Remove opções que deixaram de existir (múltipla e única). */
function podar(c: DefCampo, v: unknown): unknown {
  const opcoes = c.opcoes ?? [];
  if (c.tipo === "multipla") return Array.isArray(v) ? v.filter((o) => typeof o === "string" && opcoes.includes(o)) : [];
  if (c.tipo === "unica") return typeof v === "string" && opcoes.includes(v) ? v : "";
  return v;
}

function vazio(c: DefCampo, v: unknown): boolean {
  if (c.tipo === "lista" || c.tipo === "multipla")
    return !Array.isArray(v) || v.every((i) => typeof i !== "string" || i.trim() === "");
  return typeof v !== "string" || v.trim() === "";
}

/** Valor com que o formulário abre: o salvo, já sem opções removidas. */
export function valorInicial(c: DefCampo, salvo: unknown): ValorBruto {
  if (c.tipo === "lista") return Array.isArray(salvo) && salvo.length ? salvo.map(String) : [""];
  if (c.tipo === "multipla") return podar(c, salvo) as string[];
  if (c.tipo === "unica") return podar(c, salvo) as string;
  return typeof salvo === "string" ? salvo : "";
}

/**
 * Prepara o que vai ser gravado. Vazio = sem resposta (ausente de `limpas`); só obrigatório vazio
 * gera erro. Valores não vazios passam por `validarResposta` (opções velhas são podadas antes).
 */
export function prepararPerfil(
  campos: DefCampo[],
  valores: Record<string, unknown>,
): { erros: Record<string, string>; limpas: Record<string, ValorResposta> } {
  const erros: Record<string, string> = {};
  const limpas: Record<string, ValorResposta> = {};
  for (const c of campos) {
    const v = podar(c, valores[c.id]);
    if (vazio(c, v)) {
      if (c.obrigatorio) erros[c.id] = "Campo obrigatório";
      continue;
    }
    const r = validarResposta(c, v);
    if (!r.ok) erros[c.id] = r.erro;
    else limpas[c.id] = r.valor;
  }
  return { erros, limpas };
}
