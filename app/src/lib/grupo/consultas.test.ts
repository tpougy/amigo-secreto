import { describe, expect, test } from "bun:test";
import type { DefCampo } from "@amigo/dominio";
import { estadoPainel, paraInputData, respostasVisiveis, usuarioDaChave, type SorteioBruto } from "./consultas";

const s = (o: Partial<SorteioBruto> & { rodada: number; status: string; criadoEm: number }): SorteioBruto => ({
  id: `s${o.criadoEm}`,
  ...o,
});

describe("estadoPainel", () => {
  test("nunca sorteou", () => {
    expect(estadoPainel(0, []).tipo).toBe("nunca");
  });
  test("pendente/processando = andamento", () => {
    expect(estadoPainel(0, [s({ rodada: 1, status: "pendente", criadoEm: 1 })]).tipo).toBe("andamento");
    expect(estadoPainel(1, [s({ rodada: 1, status: "concluido", criadoEm: 1 }), s({ rodada: 2, status: "processando", criadoEm: 2 })]).tipo).toBe("andamento");
  });
  test("erro na primeira rodada, depois retry com a mesma rodada", () => {
    const erro = s({ rodada: 1, status: "erro", criadoEm: 1, erro: "São necessários pelo menos 3 participantes" });
    const e = estadoPainel(0, [erro]);
    expect(e.tipo).toBe("erro");
    expect(e.tipo === "erro" && e.sorteio.erro).toBe("São necessários pelo menos 3 participantes");
    expect(estadoPainel(1, [erro, s({ rodada: 1, status: "concluido", criadoEm: 2 })]).tipo).toBe("concluido");
  });
  test("erro ao refazer mantém o concluído anterior", () => {
    const c = s({ rodada: 1, status: "concluido", criadoEm: 1 });
    const e = estadoPainel(1, [c, s({ rodada: 2, status: "erro", criadoEm: 2 })]);
    expect(e.tipo === "erro" && e.concluido?.id).toBe(c.id);
  });
  test("concluído aponta para o sorteio da rodada atual", () => {
    const e = estadoPainel(2, [
      s({ rodada: 1, status: "concluido", criadoEm: 1 }),
      s({ rodada: 2, status: "concluido", criadoEm: 2 }),
    ]);
    expect(e.tipo === "concluido" && e.sorteio?.rodada).toBe(2);
  });
});

describe("respostasVisiveis", () => {
  const campos: DefCampo[] = [
    { id: "a", rotulo: "Gêneros", tipo: "multipla", opcoes: ["Ficção", "Poesia"], obrigatorio: true, ordem: 0 },
    { id: "b", rotulo: "Já li", tipo: "lista", obrigatorio: false, ordem: 1 },
    { id: "c", rotulo: "Obs", tipo: "texto-curto", obrigatorio: false, ordem: 2 },
  ];
  test("ordem dos campos, opção removida podada, vazio e campo inexistente fora", () => {
    const r = respostasVisiveis(campos, [
      { valor: "nota", campo: { id: "c" } },
      { valor: ["Ficção", "Terror"], campo: { id: "a" } },
      { valor: [], campo: { id: "b" } },
      { valor: "x", campo: { id: "sumiu" } },
      { valor: "sem campo", campo: null },
    ]);
    expect(r.map((x) => [x.campo.id, x.valor])).toEqual([
      ["a", ["Ficção"]],
      ["c", "nota"],
    ]);
  });
});

test("usuarioDaChave", () => {
  expect(usuarioDaChave("g1:u1")).toBe("u1");
  expect(usuarioDaChave("g1")).toBeNull();
  expect(usuarioDaChave("g1:")).toBeNull();
});

test("paraInputData no fuso de São Paulo", () => {
  expect(paraInputData("2026-12-10T12:00:00.000Z")).toBe("2026-12-10");
  expect(paraInputData(null)).toBe("");
});
