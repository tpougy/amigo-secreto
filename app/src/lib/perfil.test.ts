import { describe, expect, test } from "bun:test";
import type { DefCampo } from "@amigo/dominio";
import { prepararPerfil, valorInicial } from "./perfil";

const campo = (o: Partial<DefCampo> & Pick<DefCampo, "id" | "tipo">): DefCampo => ({
  rotulo: o.id,
  obrigatorio: false,
  ordem: 0,
  ...o,
});

describe("prepararPerfil", () => {
  test("unica opcional vazia salva (sem resposta)", () => {
    const c = campo({ id: "u", tipo: "unica", opcoes: ["A", "B"] });
    expect(prepararPerfil([c], { u: "" })).toEqual({ erros: {}, limpas: {} });
  });
  test("multipla com opção removida salva sem ela", () => {
    const c = campo({ id: "m", tipo: "multipla", opcoes: ["A", "B"] });
    expect(prepararPerfil([c], { m: ["A", "velha"] })).toEqual({ erros: {}, limpas: { m: ["A"] } });
    expect(prepararPerfil([c], { m: ["velha"] })).toEqual({ erros: {}, limpas: {} });
  });
  test("obrigatório vazio dá erro só nesse campo", () => {
    const a = campo({ id: "a", tipo: "texto-curto", obrigatorio: true });
    const b = campo({ id: "b", tipo: "lista" });
    const r = prepararPerfil([a, b], { a: "  ", b: ["", " "] });
    expect(Object.keys(r.erros)).toEqual(["a"]);
    expect(r.limpas).toEqual({});
  });
  test("valores preenchidos passam e inválidos erram", () => {
    const a = campo({ id: "a", tipo: "texto-curto" });
    const l = campo({ id: "l", tipo: "lista" });
    expect(prepararPerfil([a, l], { a: " oi ", l: ["x", ""] }).limpas).toEqual({ a: "oi", l: ["x"] });
    expect(prepararPerfil([a], { a: "x".repeat(121) }).erros.a).toBeTruthy();
  });
});

describe("valorInicial", () => {
  test("poda opções que não existem mais", () => {
    expect(valorInicial(campo({ id: "m", tipo: "multipla", opcoes: ["A"] }), ["A", "velha"])).toEqual(["A"]);
    expect(valorInicial(campo({ id: "u", tipo: "unica", opcoes: ["A"] }), "velha")).toBe("");
    expect(valorInicial(campo({ id: "l", tipo: "lista" }), undefined)).toEqual([""]);
  });
});
