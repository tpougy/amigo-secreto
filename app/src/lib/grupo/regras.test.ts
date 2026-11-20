import { describe, expect, test } from "bun:test";
import {
  bannerRemovidoAposSorteio,
  confirmacaoRefazer,
  contarAtivos,
  contarViram,
  LIMITE_RODADAS,
  motivoNaoSortear,
} from "./regras";

const p = (o: { removido?: boolean; viuParNaRodada?: number | null; removidoNaRodada?: number | null }) => ({
  removido: o.removido ?? false,
  viuParNaRodada: o.viuParNaRodada ?? null,
  removidoNaRodada: o.removidoNaRodada ?? null,
});

describe("confirmacaoRefazer", () => {
  test("limite de 3 sorteios", () => {
    expect(confirmacaoRefazer({ rodadaAtual: 3, ativos: 5, viram: 0, removidoAposSorteio: false })).toEqual({
      permitido: false,
      motivo: "Limite de 3 sorteios atingido",
    });
    expect(confirmacaoRefazer({ rodadaAtual: 4, ativos: 5, viram: 2, removidoAposSorteio: true }).permitido).toBe(false);
    expect(LIMITE_RODADAS).toBe(3);
  });
  test("menos de 3 ativos", () => {
    expect(confirmacaoRefazer({ rodadaAtual: 1, ativos: 2, viram: 0, removidoAposSorteio: true })).toEqual({
      permitido: false,
      motivo: "São necessários pelo menos 3 participantes",
    });
  });
  test("ninguém viu: confirmação simples", () => {
    expect(confirmacaoRefazer({ rodadaAtual: 1, ativos: 3, viram: 0, removidoAposSorteio: false })).toEqual({
      permitido: true,
      nivel: "simples",
      texto: "Refazer o sorteio? Ninguém viu o resultado ainda.",
    });
  });
  test("alguém viu: confirmação forte com a contagem", () => {
    expect(confirmacaoRefazer({ rodadaAtual: 2, ativos: 4, viram: 1, removidoAposSorteio: false })).toEqual({
      permitido: true,
      nivel: "forte",
      texto: "1 pessoa(s) já viram quem tiraram. Refazer troca os pares de todos.",
    });
    const r = confirmacaoRefazer({ rodadaAtual: 2, ativos: 4, viram: 3, removidoAposSorteio: true });
    expect(r.permitido && r.texto).toBe("3 pessoa(s) já viram quem tiraram. Refazer troca os pares de todos.");
  });
  test("limite vem antes da contagem de ativos", () => {
    const r = confirmacaoRefazer({ rodadaAtual: 3, ativos: 1, viram: 0, removidoAposSorteio: false });
    expect(!r.permitido && r.motivo).toBe("Limite de 3 sorteios atingido");
  });
});

describe("contarViram", () => {
  test("conta só quem viu a rodada atual e não foi removido", () => {
    const ps = [
      p({ viuParNaRodada: 2 }),
      p({ viuParNaRodada: 1 }),
      p({ viuParNaRodada: 2, removido: true }),
      p({}),
      p({ viuParNaRodada: 2 }),
    ];
    expect(contarViram(ps, 2)).toBe(2);
    expect(contarViram(ps, 1)).toBe(1);
    expect(contarViram(ps, 3)).toBe(0);
    expect(contarViram([], 1)).toBe(0);
  });
  test("rodada 0 (antes do sorteio) nunca conta", () => {
    expect(contarViram([p({ viuParNaRodada: 0 })], 0)).toBe(0);
  });
});

describe("ativos e motivo para não sortear", () => {
  test("ativos ignora removidos", () => {
    expect(contarAtivos([p({}), p({ removido: true }), p({})])).toBe(2);
  });
  test("motivo", () => {
    expect(motivoNaoSortear(2)).toBe("São necessários pelo menos 3 participantes");
    expect(motivoNaoSortear(3)).toBeNull();
  });
});

describe("bannerRemovidoAposSorteio", () => {
  test("aparece com removido na rodada atual e grupo sorteado", () => {
    expect(bannerRemovidoAposSorteio("sorteado", 1, [p({}), p({ removido: true, removidoNaRodada: 1 })])).toBe(true);
  });
  test("some depois de refazer (removido numa rodada anterior)", () => {
    expect(bannerRemovidoAposSorteio("sorteado", 2, [p({ removido: true, removidoNaRodada: 1 })])).toBe(false);
  });
  test("removido sem rodada registrada (legado) não prende o banner", () => {
    expect(bannerRemovidoAposSorteio("sorteado", 1, [p({ removido: true })])).toBe(false);
  });
  test("grupo aberto ou encerrado: nunca", () => {
    expect(bannerRemovidoAposSorteio("aberto", 0, [p({ removido: true, removidoNaRodada: 0 })])).toBe(false);
    expect(bannerRemovidoAposSorteio("encerrado", 1, [p({ removido: true, removidoNaRodada: 1 })])).toBe(false);
  });
});
