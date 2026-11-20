import { describe, expect, test } from "bun:test";
import { sortear } from "@amigo/dominio";
import { seedDoSorteio, validarSegredo } from "./seed";

const SEGREDO = "a".repeat(64);
const OUTRO = "b".repeat(64);

describe("seedDoSorteio", () => {
  test("é determinística e não é o sorteioId", () => {
    const s = seedDoSorteio(SEGREDO, "sorteio-1");
    expect(s).toBe(seedDoSorteio(SEGREDO, "sorteio-1"));
    expect(s).not.toBe("sorteio-1");
    expect(s).toMatch(/^[0-9a-f]{64}$/);
  });

  test("muda com o segredo e com o sorteioId", () => {
    expect(seedDoSorteio(SEGREDO, "x")).not.toBe(seedDoSorteio(OUTRO, "x"));
    expect(seedDoSorteio(SEGREDO, "x")).not.toBe(seedDoSorteio(SEGREDO, "y"));
  });

  test("sem o segredo, sortear(…, sorteioId) não reproduz os pares", () => {
    const ps = Array.from({ length: 12 }, (_, i) => `p${i}`);
    let iguais = 0;
    for (let i = 0; i < 50; i++) {
      const sid = `sorteio-${i}`;
      const real = sortear(ps, [], seedDoSorteio(SEGREDO, sid));
      const ingenuo = sortear(ps, [], sid);
      if (JSON.stringify(real) === JSON.stringify(ingenuo)) iguais++;
    }
    expect(iguais).toBe(0);
  });

  test("segredo ausente ou curto é recusado", () => {
    expect(() => validarSegredo(undefined)).toThrow("SORTEIO_SEGREDO ausente");
    expect(() => validarSegredo("")).toThrow("SORTEIO_SEGREDO ausente");
    expect(() => validarSegredo("abc")).toThrow("SORTEIO_SEGREDO curto");
    expect(() => seedDoSorteio("abc", "x")).toThrow("SORTEIO_SEGREDO curto");
    expect(validarSegredo(SEGREDO)).toBe(SEGREDO);
  });
});
