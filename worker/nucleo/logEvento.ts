// Converte um evento do runner (instant-commands) em campos para o `log`. O `log` é "nunca dados de
// pessoas": o `error` de `run.failed` e afins pode ser a mensagem crua de uma exceção (Instant,
// OpenWorkflow, handler), então só a classe do erro sai. Em `command.failed`, `error` é a nossa
// mensagem fixa (a gravada no pedido) e fica como está.
import type { RunnerEvent } from "instant-commands/worker";

type Campos = Record<string, string | number | boolean>;

/** Só o nome da classe do erro (`TypeError`, `InstantAPIError`...), ou "desconhecido". */
export function classeDoErro(mensagem: string): string {
  return /^([A-Z][A-Za-z0-9]*(?:Error|Exception|Failure))\b/.exec(mensagem)?.[1] ?? "desconhecido";
}

export function camposDoEvento(e: RunnerEvent): Campos {
  const out: Campos = {};
  for (const [k, v] of Object.entries(e)) {
    if (k === "error" && e.type !== "command.failed") {
      if (typeof v === "string") out.erroClasse = classeDoErro(v);
    } else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (Array.isArray(v)) out[k] = v.join(",");
  }
  return out;
}
