import { describe, expect, test } from "bun:test";
import type { DefCampo } from "@amigo/dominio";
import { emAndamento, erroReabertura, estadoPainel, rotuloStatusSorteio, reabertoEm, reabrindo, paraInputData, respostasVisiveis, usuarioDaChave, type SorteioBruto } from "./consultas";

const s = (o: Partial<SorteioBruto> & { rodada: number; status: string; createdAt: number }): SorteioBruto => ({
  id: `s${o.createdAt}`,
  ...o,
});

describe("estadoPainel", () => {
  test("grupo reaberto (rodadaAtual == rodadaBase) volta a 'nunca'", () => {
    const c = s({ rodada: 1, status: "done", createdAt: 1 });
    expect(estadoPainel(1, [c], 1).tipo).toBe("nunca");
    expect(estadoPainel(1, [c], 0).tipo).toBe("concluido");
    expect(estadoPainel(1, [c], null).tipo).toBe("concluido");
    // Sorteio novo depois de reabrir: andamento, erro (sem "concluído" anterior) e concluído.
    expect(estadoPainel(1, [c, s({ rodada: 2, status: "pending", createdAt: 2 })], 1).tipo).toBe("andamento");
    const e = estadoPainel(1, [c, s({ rodada: 2, status: "failed", createdAt: 2 })], 1);
    expect(e.tipo === "erro" && e.concluido).toBeNull();
    const e2 = estadoPainel(2, [c, s({ rodada: 2, status: "done", createdAt: 2 })], 1);
    expect(e2.tipo === "concluido" && e2.sorteio?.rodada).toBe(2);
  });
  test("erro de refazer anterior à última reabertura concluída é ignorado", () => {
    const c = s({ rodada: 1, status: "done", createdAt: 1 });
    const erroAntigo = s({ rodada: 2, status: "failed", createdAt: 2 });
    // Refazer falhou (rodada 2), depois o grupo foi reaberto (rodadaBase 1) em t=3.
    expect(estadoPainel(1, [c, erroAntigo], 1, 3).tipo).toBe("nunca");
    // Sem a data da reabertura, comportamento antigo (erro).
    expect(estadoPainel(1, [c, erroAntigo], 1).tipo).toBe("erro");
    // Erro de um sorteio pedido depois de reabrir continua aparecendo.
    const erroNovo = s({ rodada: 2, status: "failed", createdAt: 4 });
    expect(estadoPainel(1, [c, erroAntigo, erroNovo], 1, 3).tipo).toBe("erro");
  });
  test("reabertoEm: a última reabertura concluída", () => {
    expect(reabertoEm([])).toBeNull();
    expect(
      reabertoEm([
        { id: "a", status: "done", createdAt: 1 },
        { id: "b", status: "done", createdAt: 3 },
        { id: "c", status: "failed", createdAt: 5 },
        { id: "d", status: "pending", createdAt: 6 },
      ]),
    ).toBe(3);
  });
  test("nunca sorteou", () => {
    expect(estadoPainel(0, []).tipo).toBe("nunca");
  });
  test("pending/running = andamento", () => {
    expect(estadoPainel(0, [s({ rodada: 1, status: "pending", createdAt: 1 })]).tipo).toBe("andamento");
    expect(estadoPainel(1, [s({ rodada: 1, status: "done", createdAt: 1 }), s({ rodada: 2, status: "running", createdAt: 2 })]).tipo).toBe("andamento");
  });
  test("erro na primeira rodada, depois retry com a mesma rodada", () => {
    const erro = s({ rodada: 1, status: "failed", createdAt: 1, error: "São necessários pelo menos 3 participantes" });
    const e = estadoPainel(0, [erro]);
    expect(e.tipo).toBe("erro");
    expect(e.tipo === "erro" && e.sorteio.error).toBe("São necessários pelo menos 3 participantes");
    expect(estadoPainel(1, [erro, s({ rodada: 1, status: "done", createdAt: 2 })]).tipo).toBe("concluido");
  });
  test("erro ao refazer mantém o concluído anterior", () => {
    const c = s({ rodada: 1, status: "done", createdAt: 1 });
    const e = estadoPainel(1, [c, s({ rodada: 2, status: "failed", createdAt: 2 })]);
    expect(e.tipo === "erro" && e.concluido?.id).toBe(c.id);
  });
  test("concluído aponta para o sorteio da rodada atual", () => {
    const e = estadoPainel(2, [
      s({ rodada: 1, status: "done", createdAt: 1 }),
      s({ rodada: 2, status: "done", createdAt: 2 }),
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
  const r = (status: string, createdAt: number, error?: string) => ({ id: `r${createdAt}`, status, createdAt, error });
  test("reabrindo() é true com reabertura running", () => {
    expect(reabrindo([r("running", 1)])).toBe(true);
    expect(reabrindo([r("done", 1), r("running", 2)])).toBe(true);
  });
  test("estadoPainel: sorteio running é andamento", () => {
    expect(estadoPainel(0, [s({ rodada: 1, status: "running", createdAt: 1 })]).tipo).toBe("andamento");
  });
  test("emAndamento: running conta", () => {
    expect(emAndamento([s({ rodada: 1, status: "running", createdAt: 1 })])).toBe(true);
    expect(emAndamento([s({ rodada: 1, status: "pending", createdAt: 1 })])).toBe(true);
    expect(emAndamento([s({ rodada: 1, status: "done", createdAt: 1 })])).toBe(false);
    expect(emAndamento([s({ rodada: 1, status: "failed", createdAt: 1 })])).toBe(false);
  });
  test("rotuloStatusSorteio com os status novos", () => {
    expect(rotuloStatusSorteio).toEqual({ pending: "Na fila", running: "Sorteando", done: "Concluído", failed: "Erro" });
  });
  test("reabrindo enquanto há pending", () => {
    expect(reabrindo([])).toBe(false);
    expect(reabrindo([r("done", 1), r("pending", 2)])).toBe(true);
    expect(reabrindo([r("failed", 1)])).toBe(false);
  });
  test("erro da última reabertura só com o grupo sorteado", () => {
    expect(erroReabertura("sorteado", [r("done", 1), r("failed", 2, "Há um sorteio em andamento")])).toBe(
      "Há um sorteio em andamento",
    );
    expect(erroReabertura("aberto", [r("done", 1), r("failed", 2, "O grupo não está sorteado")])).toBeNull();
    expect(erroReabertura("sorteado", [r("failed", 1, "x"), r("done", 2)])).toBeNull();
    expect(erroReabertura("sorteado", [])).toBeNull();
    // Clique duplo antes de um sorteio novo (concluído em 5): o erro velho some.
    expect(erroReabertura("sorteado", [r("done", 1), r("failed", 2, "O grupo não está sorteado")], 5)).toBeNull();
    expect(erroReabertura("sorteado", [r("failed", 6, "Há um sorteio em andamento")], 5)).toBe("Há um sorteio em andamento");
  });
});
