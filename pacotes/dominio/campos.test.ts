import { describe, expect, test } from "bun:test";
import { limparRespostas, perfilCompleto, validarResposta, type DefCampo } from "./campos";

const def = (p: Partial<DefCampo> & Pick<DefCampo, "tipo">): DefCampo => ({
  id: "x", rotulo: "X", obrigatorio: false, ordem: 1, ...p,
});

describe("validarResposta", () => {
  test("texto-curto: limite 120 e trim", () => {
    const c = def({ tipo: "texto-curto" });
    expect(validarResposta(c, "  oi  ")).toEqual({ ok: true, valor: "oi" });
    expect(validarResposta(c, "a".repeat(120)).ok).toBe(true);
    expect(validarResposta(c, "a".repeat(121)).ok).toBe(false);
  });
  test("texto-longo: limite 2000", () => {
    const c = def({ tipo: "texto-longo" });
    expect(validarResposta(c, "a".repeat(2000)).ok).toBe(true);
    expect(validarResposta(c, "a".repeat(2001)).ok).toBe(false);
    expect(validarResposta(c, " x\n")).toEqual({ ok: true, valor: "x" });
  });
  test("lista: remove vazios, máximo 30 itens de 120", () => {
    const c = def({ tipo: "lista" });
    expect(validarResposta(c, [" a ", "", "  ", "b"])).toEqual({ ok: true, valor: ["a", "b"] });
    expect(validarResposta(c, Array.from({ length: 30 }, (_, i) => `i${i}`)).ok).toBe(true);
    expect(validarResposta(c, Array.from({ length: 31 }, (_, i) => `i${i}`)).ok).toBe(false);
    expect(validarResposta(c, ["a".repeat(121)]).ok).toBe(false);
  });
  test("multipla recusa opção inexistente", () => {
    const c = def({ tipo: "multipla", opcoes: ["a", "b"] });
    expect(validarResposta(c, ["a"])).toEqual({ ok: true, valor: ["a"] });
    expect(validarResposta(c, ["a", "z"])).toEqual({ ok: false, erro: "Opção inválida" });
  });
  test("unica exige exatamente uma opção existente", () => {
    const c = def({ tipo: "unica", opcoes: ["a", "b"] });
    expect(validarResposta(c, "a")).toEqual({ ok: true, valor: "a" });
    expect(validarResposta(c, "z").ok).toBe(false);
    expect(validarResposta(c, ["a", "b"]).ok).toBe(false);
  });
  test("tipo errado dá ok:false sem lançar", () => {
    expect(validarResposta(def({ tipo: "texto-curto" }), 5).ok).toBe(false);
    expect(validarResposta(def({ tipo: "lista" }), "a").ok).toBe(false);
    expect(validarResposta(def({ tipo: "lista" }), [1]).ok).toBe(false);
    expect(validarResposta(def({ tipo: "multipla", opcoes: ["a"] }), "a").ok).toBe(false);
    expect(validarResposta(def({ tipo: "texto-longo" }), null).ok).toBe(false);
  });
});

describe("perfilCompleto e limparRespostas", () => {
  const campos = [
    def({ id: "g", tipo: "multipla", opcoes: ["romance", "fantasia"], obrigatorio: true }),
    def({ id: "o", tipo: "texto-longo" }),
  ];
  test("obrigatório vazio => falso", () => {
    expect(perfilCompleto(campos, {})).toBe(false);
    expect(perfilCompleto(campos, { g: [] })).toBe(false);
    expect(perfilCompleto([def({ id: "t", tipo: "texto-curto", obrigatorio: true })], { t: "  " })).toBe(false);
  });
  test("só não obrigatórios vazios => verdadeiro", () => {
    expect(perfilCompleto(campos, { g: ["romance"], o: "" })).toBe(true);
  });
  test("campo removido é ignorado", () => {
    const r = { g: ["romance"], x: "lixo" };
    expect(perfilCompleto(campos, r)).toBe(true);
    expect(limparRespostas(campos, r)).toEqual({ g: ["romance"] });
  });
  test("opção removida é descartada", () => {
    const r = { g: ["romance", "terror"] };
    expect(limparRespostas(campos, r)).toEqual({ g: ["romance"] });
    expect(perfilCompleto(campos, r)).toBe(true);
    expect(perfilCompleto(campos, { g: ["terror"] })).toBe(false);
  });
  test("lixo não lança", () => {
    expect(() => perfilCompleto(campos, { g: 5, o: { a: 1 } })).not.toThrow();
    expect(limparRespostas(campos, { g: 5, o: null, toString: 1 })).toEqual({});
  });
});
