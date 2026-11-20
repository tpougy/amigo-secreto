import { describe, expect, test } from "bun:test";
import { ALFABETO_CODIGO, formatarCodigo, gerarCodigo, normalizarCodigo } from "./codigo";

describe("normalizarCodigo", () => {
  test("aceita ruído de digitação", () => {
    expect(normalizarCodigo("kq7 m4p")).toBe("KQ7M4P");
    expect(normalizarCodigo("KQ7-M4P ")).toBe("KQ7M4P");
    expect(normalizarCodigo("kq7m4p")).toBe("KQ7M4P");
  });
  test("recusa inválidos", () => {
    for (const e of ["KQ7M40", "KQ7M4", "KQ7M4PP", "KQ7-M4O", ""]) {
      expect(normalizarCodigo(e)).toBeNull();
    }
  });
});

describe("gerarCodigo", () => {
  test("10.000 códigos válidos e estáveis na normalização", () => {
    for (let i = 0; i < 10_000; i++) {
      const c = gerarCodigo();
      expect(c).toMatch(/^[BCDFGHJKMNPQRSTVWXZ2-9]{6}$/);
      expect(normalizarCodigo(c)).toBe(c);
    }
  });
  test("determinístico com gerador injetado", () => {
    const f = () => new Uint8Array([0, 1, 2, 3, 4, 5]);
    const esperado = [0, 1, 2, 3, 4, 5].map((i) => ALFABETO_CODIGO[i]).join("");
    expect(gerarCodigo(f)).toBe(esperado);
    expect(gerarCodigo(f)).toBe(gerarCodigo(f));
  });
  test("rejeita bytes >= 243", () => {
    const seq = [255, 243, 0, 1, 2, 3, 4, 5];
    let i = 0;
    const f = (n: number) => new Uint8Array(n).map(() => seq[i++ % seq.length]!);
    expect(gerarCodigo(f)).toBe([0, 1, 2, 3, 4, 5].map((k) => ALFABETO_CODIGO[k]).join(""));
  });
});

test("formatarCodigo", () => {
  expect(formatarCodigo("KQ7M4P")).toBe("KQ7-M4P");
});
