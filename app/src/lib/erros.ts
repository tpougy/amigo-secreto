// Mensagem legível de um erro do Instant (InstantAPIError traz `body.message`).
export function mensagemDeErro(e: unknown): string {
  if (e && typeof e === "object") {
    const corpo = (e as { body?: { message?: unknown } }).body;
    if (corpo && typeof corpo.message === "string" && corpo.message) return corpo.message;
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === "string" && msg) return msg;
  }
  return "Algo deu errado. Tente de novo.";
}
