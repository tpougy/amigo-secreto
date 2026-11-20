/** Uma linha JSON no stdout. Por contrato: só ids, contagens e nomes de passo, nunca dados de pessoas. */
export function log(evento: string, dados: Record<string, string | number | boolean> = {}): void {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), evento, ...dados })}\n`);
}
