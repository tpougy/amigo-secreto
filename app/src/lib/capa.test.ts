import { describe, expect, test } from "bun:test";
import { caminhoCapa, dimensoesAlvo, urlCapa } from "./capa";

describe("dimensoesAlvo", () => {
  test("foto de celular 4032×3024 vira 1600×1200", () => {
    expect(dimensoesAlvo(4032, 3024)).toEqual({ largura: 1600, altura: 1200 });
  });
  test("retrato 3024×4032 vira 1200×1600", () => {
    expect(dimensoesAlvo(3024, 4032)).toEqual({ largura: 1200, altura: 1600 });
  });
  test("imagem pequena não é ampliada", () => {
    expect(dimensoesAlvo(800, 600)).toEqual({ largura: 800, altura: 600 });
  });
  test("panorâmica extrema não zera a altura", () => {
    expect(dimensoesAlvo(100000, 10)).toEqual({ largura: 1600, altura: 1 });
  });
});

describe("urlCapa", () => {
  test("objeto com url", () => expect(urlCapa({ id: "f", url: "https://x/y" })).toBe("https://x/y"));
  test("id solto (arquivo escondido pela regra) e vazio", () => {
    expect(urlCapa("f1")).toBeNull();
    expect(urlCapa(null)).toBeNull();
    expect(urlCapa(undefined)).toBeNull();
    expect(urlCapa({ id: "f" })).toBeNull();
  });
});

test("caminhoCapa", () => expect(caminhoCapa("g1")).toBe("grupos/g1/capa.jpg"));
