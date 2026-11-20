import { describe, expect, test } from "bun:test";
import { ErroSorteio, seedDe, sortear, type Restricao } from "./sortear";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

function restricoesDe(p: string[]): Restricao[] {
  const r: Restricao[] = [];
  for (let i = 0; i + 1 < p.length; i += 3) r.push({ a: p[i]!, b: p[i + 1]! });
  return r;
}

describe("sortear", () => {
  test("invariantes para 3 a 30 participantes e 200 seeds", () => {
    for (let n = 3; n <= 30; n++) {
      const p = ids(n);
      const restricoes = n >= 5 ? restricoesDe(p) : [];
      for (let s = 0; s < 200; s++) {
        const pares = sortear(p, restricoes, `seed-${s}`);
        expect(pares.length).toBe(n);
        expect(new Set(pares.map((x) => x.doador)).size).toBe(n);
        expect(new Set(pares.map((x) => x.receptor)).size).toBe(n);
        for (const { doador, receptor } of pares) {
          expect(p).toContain(doador);
          expect(p).toContain(receptor);
          expect(doador).not.toBe(receptor);
          for (const r of restricoes) {
            const viola =
              (doador === r.a && receptor === r.b) || (doador === r.b && receptor === r.a);
            expect(viola).toBe(false);
          }
        }
      }
    }
  });

  test("mesma seed gera os mesmos pares em qualquer ordem de entrada", () => {
    const p = ids(10);
    const base = sortear(p, [], "abc");
    const embaralhado = [...p].reverse();
    embaralhado.push(embaralhado.shift()!);
    expect(sortear(embaralhado, [], "abc")).toEqual(base);
    expect(sortear(p, [], "abc")).toEqual(base);
  });

  test("seeds diferentes geram resultados diferentes em pelo menos 90% das tentativas", () => {
    const p = ids(6);
    let diferentes = 0;
    for (let i = 0; i < 100; i++) {
      const a = JSON.stringify(sortear(p, [], `a-${i}`));
      const b = JSON.stringify(sortear(p, [], `b-${i}`));
      if (a !== b) diferentes++;
    }
    expect(diferentes).toBeGreaterThanOrEqual(90);
  });

  test("com 2 participantes lança poucos-participantes", () => {
    try {
      sortear(["a", "b"], [], "s");
      throw new Error("não lançou");
    } catch (e) {
      expect(e).toBeInstanceOf(ErroSorteio);
      expect((e as ErroSorteio).codigo).toBe("poucos-participantes");
      expect((e as ErroSorteio).message).toBe("São necessários pelo menos 3 participantes");
    }
  });

  test("restrições impossíveis lançam restricoes-impossiveis", () => {
    try {
      sortear(["a", "b", "c"], [{ a: "a", b: "b" }, { a: "a", b: "c" }], "s");
      throw new Error("não lançou");
    } catch (e) {
      expect(e).toBeInstanceOf(ErroSorteio);
      expect((e as ErroSorteio).codigo).toBe("restricoes-impossiveis");
      expect((e as ErroSorteio).message).toBe("As restrições tornam o sorteio impossível");
    }
  });

  test("restrição citando id fora dos participantes é ignorada", () => {
    const pares = sortear(
      ["a", "b", "c"],
      [{ a: "a", b: "removido" }, { a: "x", b: "y" }],
      "s",
    );
    expect(pares.length).toBe(3);
  });

  test("restrições órfãs não tornam impossível um grupo que seria possível", () => {
    // a–b e a–c com c removido: a–c é órfã e a–b sozinha é possível com 4.
    const pares = sortear(["a", "b", "d", "e"], [{ a: "a", b: "b" }, { a: "a", b: "c" }], "s");
    expect(pares.length).toBe(4);
  });

  test("caso que exige backtracking (ciclo único impossível) ainda resolve", () => {
    // a só pode dar a d; nenhum ciclo único existe, então a atribuição geral resolve.
    const pares = sortear(
      ["a", "b", "c", "d"],
      [{ a: "a", b: "b" }, { a: "c", b: "d" }, { a: "a", b: "c" }],
      "s",
    );
    expect(pares.length).toBe(4);
  });

  test("Hall violado em 22 e 30 participantes lança rápido", () => {
    for (const n of [22, 30]) {
      const p = ids(n);
      const restricoes: Restricao[] = [];
      // p(n-2) e p(n-1) só podem dar a p00.
      for (const d of [p[n - 2]!, p[n - 1]!]) {
        for (let j = 1; j < n; j++) if (p[j] !== d) restricoes.push({ a: d, b: p[j]! });
      }
      const t0 = performance.now();
      try {
        sortear(p, restricoes, "s");
        throw new Error("não lançou");
      } catch (e) {
        expect((e as ErroSorteio).codigo).toBe("restricoes-impossiveis");
      }
      expect(performance.now() - t0).toBeLessThan(500);
    }
  });

  test("caso denso e viável (n=20, 5 restrições por pessoa) cumpre invariantes", () => {
    const n = 20;
    const p = ids(n);
    const restricoes: Restricao[] = [];
    for (let i = 0; i < n; i++) for (const k of [2, 3, 5, 7, 11]) restricoes.push({ a: p[i]!, b: p[(i + k) % n]! });
    const proibido = new Set(restricoes.flatMap((r) => [`${r.a}|${r.b}`, `${r.b}|${r.a}`]));
    for (let s = 0; s < 50; s++) {
      const pares = sortear(p, restricoes, `d-${s}`);
      expect(new Set(pares.map((x) => x.doador)).size).toBe(n);
      expect(new Set(pares.map((x) => x.receptor)).size).toBe(n);
      for (const x of pares) {
        expect(x.doador).not.toBe(x.receptor);
        expect(proibido.has(`${x.doador}|${x.receptor}`)).toBe(false);
      }
      expect(sortear([...p].reverse(), restricoes, `d-${s}`)).toEqual(pares);
    }
  });

  test("seedDe é identidade", () => {
    expect(seedDe("abc")).toBe("abc");
  });
});
