import { describe, expect, test } from "bun:test";
import type { DefCampo } from "@amigo/dominio";
import { erroReabertura, estadoPainel, reabertoEm, reabrindo, paraInputData, respostasVisiveis, usuarioDaChave, type SorteioBruto } from "./consultas";

const s = (o: Partial<SorteioBruto> & { rodada: number; status: string; criadoEm: number }): SorteioBruto => ({
  id: `s${o.criadoEm}`,
  ...o,
});

describe("estadoPainel", () => {
  test("grupo reaberto (rodadaAtual == rodadaBase) volta a 'nunca'", () => {
    const c = s({ rodada: 1, status: "concluido", criadoEm: 1 });
    expect(estadoPainel(1, [c], 1).tipo).toBe("nunca");
    expect(estadoPainel(1, [c], 0).tipo).toBe("concluido");
    expect(estadoPainel(1, [c], null).tipo).toBe("concluido");
    // Sorteio novo depois de reabrir: andamento, erro (sem "concluído" anterior) e concluído.
    expect(estadoPainel(1, [c, s({ rodada: 2, status: "pendente", criadoEm: 2 })], 1).tipo).toBe("andamento");
    const e = estadoPainel(1, [c, s({ rodada: 2, status: "erro", criadoEm: 2 })], 1);
    expect(e.tipo === "erro" && e.concluido).toBeNull();
    const e2 = estadoPainel(2, [c, s({ rodada: 2, status: "concluido", criadoEm: 2 })], 1);
    expect(e2.tipo === "concluido" && e2.sorteio?.rodada).toBe(2);
  });
  test("erro de refazer anterior à última reabertura concluída é ignorado", () => {
    const c = s({ rodada: 1, status: "concluido", criadoEm: 1 });
    const erroAntigo = s({ rodada: 2, status: "erro", criadoEm: 2 });
    // Refazer falhou (rodada 2), depois o grupo foi reaberto (rodadaBase 1) em t=3.
    expect(estadoPainel(1, [c, erroAntigo], 1, 3).tipo).toBe("nunca");
    // Sem a data da reabertura, comportamento antigo (erro).
    expect(estadoPainel(1, [c, erroAntigo], 1).tipo).toBe("erro");
    // Erro de um sorteio pedido depois de reabrir continua aparecendo.
    const erroNovo = s({ rodada: 2, status: "erro", criadoEm: 4 });
    expect(estadoPainel(1, [c, erroAntigo, erroNovo], 1, 3).tipo).toBe("erro");
  });
  test("reabertoEm: a última reabertura concluída", () => {
    expect(reabertoEm([])).toBeNull();
    expect(
      reabertoEm([
        { id: "a", status: "concluido", criadoEm: 1 },
        { id: "b", status: "concluido", criadoEm: 3 },
        { id: "c", status: "erro", criadoEm: 5 },
        { id: "d", status: "pendente", criadoEm: 6 },
      ]),
    ).toBe(3);
  });
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

describe("reaberturas", () => {
  const r = (status: string, criadoEm: number, erro?: string) => ({ id: `r${criadoEm}`, status, criadoEm, erro });
  test("reabrindo enquanto há pendente", () => {
    expect(reabrindo([])).toBe(false);
    expect(reabrindo([r("concluido", 1), r("pendente", 2)])).toBe(true);
    expect(reabrindo([r("erro", 1)])).toBe(false);
  });
  test("erro da última reabertura só com o grupo sorteado", () => {
    expect(erroReabertura("sorteado", [r("concluido", 1), r("erro", 2, "Há um sorteio em andamento")])).toBe(
      "Há um sorteio em andamento",
    );
    expect(erroReabertura("aberto", [r("concluido", 1), r("erro", 2, "O grupo não está sorteado")])).toBeNull();
    expect(erroReabertura("sorteado", [r("erro", 1, "x"), r("concluido", 2)])).toBeNull();
    expect(erroReabertura("sorteado", [])).toBeNull();
    // Clique duplo antes de um sorteio novo (concluído em 5): o erro velho some.
    expect(erroReabertura("sorteado", [r("concluido", 1), r("erro", 2, "O grupo não está sorteado")], 5)).toBeNull();
    expect(erroReabertura("sorteado", [r("erro", 6, "Há um sorteio em andamento")], 5)).toBe("Há um sorteio em andamento");
  });
});
