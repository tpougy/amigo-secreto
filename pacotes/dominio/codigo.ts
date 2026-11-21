export const ALFABETO_CODIGO = "BCDFGHJKMNPQRSTVWXZ23456789";

const TAMANHO = 6;
// Maior múltiplo de 27 que cabe em um byte: 27 * 9 = 243. Bytes >= 243 são descartados.
const LIMITE = 243;

function aleatorioPadrao(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function gerarCodigo(aleatorio: (n: number) => Uint8Array = aleatorioPadrao): string {
  let codigo = "";
  while (codigo.length < TAMANHO) {
    for (const byte of aleatorio(TAMANHO - codigo.length)) {
      if (byte >= LIMITE) continue;
      codigo += ALFABETO_CODIGO[byte % ALFABETO_CODIGO.length];
      if (codigo.length === TAMANHO) break;
    }
  }
  return codigo;
}

export function normalizarCodigo(entrada: string): string | null {
  const limpo = entrada.replace(/[\s-]/g, "").toUpperCase();
  if (limpo.length !== TAMANHO) return null;
  for (const c of limpo) if (!ALFABETO_CODIGO.includes(c)) return null;
  return limpo;
}

export function formatarCodigo(codigo: string): string {
  return `${codigo.slice(0, 3)}-${codigo.slice(3)}`;
}
