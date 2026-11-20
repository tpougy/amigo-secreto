export type Restricao = { a: string; b: string };
export type Par = { doador: string; receptor: string };

export class ErroSorteio extends Error {
  constructor(
    public codigo: "poucos-participantes" | "restricoes-impossiveis",
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroSorteio";
  }
}

const TENTATIVAS_CICLO = 1000;

function fnv1a(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(semente: number): () => number {
  let a = semente;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function embaralhar<T>(lista: T[], rnd: () => number): T[] {
  const r = [...lista];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [r[i], r[j]] = [r[j]!, r[i]!];
  }
  return r;
}

/**
 * Sorteio determinístico pela `seed`. A seed precisa ser secreta (o worker usa
 * HMAC(SORTEIO_SEGREDO, sorteioId)): quem a conhece recalcula todos os pares.
 */
export function sortear(participantes: string[], restricoes: Restricao[], seed: string): Par[] {
  const ids = [...new Set(participantes)].sort();
  const n = ids.length;
  if (n < 3) throw new ErroSorteio("poucos-participantes", "São necessários pelo menos 3 participantes");

  // Restrições citando ids que não participam são ignoradas.
  const presentes = new Set(ids);
  const proibido = new Set<string>();
  for (const r of restricoes) {
    if (!presentes.has(r.a) || !presentes.has(r.b)) continue;
    proibido.add(`${r.a}\u0000${r.b}`);
    proibido.add(`${r.b}\u0000${r.a}`);
  }
  const ok = (d: string, r: string) => d !== r && !proibido.has(`${d}\u0000${r}`);

  const rnd = mulberry32(fnv1a(seed));

  // 1) Ciclo único (evita pares fechados A↔B).
  for (let t = 0; t < TENTATIVAS_CICLO; t++) {
    const ordem = embaralhar(ids, rnd);
    if (ordem.every((d, i) => ok(d, ordem[(i + 1) % n]!))) {
      return ordem.map((d, i) => ({ doador: d, receptor: ordem[(i + 1) % n]! }));
    }
  }

  // 2) Atribuição geral. A cada passo, só aceitamos um receptor se o restante ainda admite
  // emparelhamento perfeito (Kuhn, polinomial). Assim nunca há retrocesso exponencial:
  // sem emparelhamento inicial é impossível; com ele, o primeiro candidato viável sempre completa.
  const candidatos = ids.map((d) => embaralhar(ids.filter((r) => ok(d, r)), rnd));
  const usado = new Set<string>();

  const viavel = (inicio: number): boolean => {
    const dono = new Map<string, number>();
    const tentar = (i: number, visto: Set<string>): boolean => {
      for (const r of candidatos[i]!) {
        if (usado.has(r) || visto.has(r)) continue;
        visto.add(r);
        const atual = dono.get(r);
        if (atual === undefined || tentar(atual, visto)) {
          dono.set(r, i);
          return true;
        }
      }
      return false;
    };
    for (let i = inicio; i < n; i++) if (!tentar(i, new Set())) return false;
    return true;
  };

  if (!viavel(0)) throw new ErroSorteio("restricoes-impossiveis", "As restrições tornam o sorteio impossível");
  const escolha: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = candidatos[i]!.find((c) => {
      if (usado.has(c)) return false;
      usado.add(c);
      if (viavel(i + 1)) return true;
      usado.delete(c);
      return false;
    });
    if (r === undefined) throw new ErroSorteio("restricoes-impossiveis", "As restrições tornam o sorteio impossível");
    escolha[i] = r;
  }
  return ids.map((d, i) => ({ doador: d, receptor: escolha[i]! }));
}
