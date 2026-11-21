import { describe, expect, test } from "bun:test";
import {
  bannerRemovidoAposSorteio,
  confirmacaoReabrir,
  confirmacaoRefazer,
  estadoParaParticipante,
  contarAtivos,
  contarViram,
  foraDoSorteio,
  LIMITE_RODADAS,
  motivoNaoSortear,
  rodadasNestaAbertura,
  textoBannerRemovido,
  textoRemocao,
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

describe("textoRemocao", () => {
  test("antes do sorteio: sai do grupo", () => {
    expect(textoRemocao(0)).toBe("A pessoa sai do grupo e as respostas do perfil dela são apagadas.");
  });
  test("rodadas 1 e 2: exige refazer", () => {
    for (const r of [1, 2]) expect(textoRemocao(r)).toContain("exige refazer o sorteio");
  });
  test("rodada 3 (limite): não dá para refazer e a corrente se quebra", () => {
    for (const r of [3, 4]) {
      const t = textoRemocao(r);
      expect(t).toContain("não pode mais ser refeito");
      expect(t).toContain("Quem tirou essa pessoa fica sem amigo secreto");
      expect(t).not.toContain("exige refazer");
    }
  });
});

describe("textoBannerRemovido", () => {
  test("convida a refazer só abaixo do limite", () => {
    expect(textoBannerRemovido(2)).toContain("Refaça o sorteio");
    expect(textoBannerRemovido(3)).not.toContain("Refaça");
    expect(textoBannerRemovido(3)).toContain("ficou sem amigo secreto");
  });
});

describe("foraDoSorteio", () => {
  const base = { status: "sorteado", rodadaAtual: 1, souParticipanteAtivo: true, temPar: false, andamento: false };
  test("sorteado, ativo e sem par → fora", () => {
    expect(foraDoSorteio(base)).toBe(true);
  });
  test("com par, removido, grupo aberto/encerrado ou sorteio em andamento → não", () => {
    expect(foraDoSorteio({ ...base, temPar: true })).toBe(false);
    expect(foraDoSorteio({ ...base, souParticipanteAtivo: false })).toBe(false);
    expect(foraDoSorteio({ ...base, status: "aberto", rodadaAtual: 0 })).toBe(false);
    expect(foraDoSorteio({ ...base, status: "encerrado" })).toBe(false);
    expect(foraDoSorteio({ ...base, andamento: true })).toBe(false);
  });
});

describe("reabrir grupo", () => {
  test("confirmacaoReabrir: ninguém viu = simples", () => {
    expect(confirmacaoReabrir({ viram: 0 })).toEqual({
      nivel: "simples",
      texto: "Reabrir desfaz o sorteio. Ninguém viu o resultado ainda.",
    });
  });
  test("confirmacaoReabrir: alguém viu = forte", () => {
    expect(confirmacaoReabrir({ viram: 2 })).toEqual({
      nivel: "forte",
      texto: "2 pessoa(s) já viram quem tiraram. Reabrir desfaz o sorteio de todos.",
    });
  });
  test("rodadasNestaAbertura: rodadaBase ausente vale 0", () => {
    expect(rodadasNestaAbertura({ rodadaAtual: 2 })).toBe(2);
    expect(rodadasNestaAbertura({ rodadaAtual: 2, rodadaBase: null })).toBe(2);
    expect(rodadasNestaAbertura({ rodadaAtual: 2, rodadaBase: 0 })).toBe(2);
    expect(rodadasNestaAbertura({ rodadaAtual: 4, rodadaBase: 3 })).toBe(1);
    expect(rodadasNestaAbertura({ rodadaAtual: 3, rodadaBase: 3 })).toBe(0);
  });
  test("confirmacaoRefazer conta o limite por abertura", () => {
    expect(confirmacaoRefazer({ rodadaAtual: 4, rodadaBase: 3, ativos: 5, viram: 0, removidoAposSorteio: false })).toEqual({
      permitido: true,
      nivel: "simples",
      texto: "Refazer o sorteio? Ninguém viu o resultado ainda.",
    });
    expect(confirmacaoRefazer({ rodadaAtual: 6, rodadaBase: 3, ativos: 5, viram: 0, removidoAposSorteio: false })).toEqual({
      permitido: false,
      motivo: "Limite de 3 sorteios atingido",
    });
  });
  test("estadoParaParticipante: os 4 casos", () => {
    expect(estadoParaParticipante({ status: "aberto", rodadaAtual: 0 }, false)).toBe("aguardando");
    expect(estadoParaParticipante({ status: "aberto", rodadaAtual: 1 }, false, { entrouEm: 1 }, 5)).toBe("desfeito");
    expect(estadoParaParticipante({ status: "sorteado", rodadaAtual: 1 }, true)).toBe("tirou");
    expect(estadoParaParticipante({ status: "sorteado", rodadaAtual: 2 }, false)).toBe("fora");
    expect(estadoParaParticipante({ status: "encerrado", rodadaAtual: 1 }, true)).toBe("tirou");
  });
  test("estadoParaParticipante: só quem já estava no grupo vê o sorteio desfeito", () => {
    const g = { status: "aberto", rodadaAtual: 1 };
    const reaberto = "2026-11-20T12:00:00.000Z";
    // Entrou antes da reabertura (mesmo sem ter visto o par): desfeito.
    expect(estadoParaParticipante(g, false, { entrouEm: "2026-11-19T12:00:00.000Z", viuParNaRodada: null }, reaberto)).toBe("desfeito");
    // Retardatário (entrou depois de reabrir): aguardando.
    expect(estadoParaParticipante(g, false, { entrouEm: "2026-11-20T13:00:00.000Z", viuParNaRodada: null }, reaberto)).toBe("aguardando");
    // Já viu um par: desfeito, mesmo sem a data da reabertura (ex.: apagada pelo organizador).
    expect(estadoParaParticipante(g, false, { entrouEm: "2026-11-20T13:00:00.000Z", viuParNaRodada: 1 }, null)).toBe("desfeito");
    // Sem participação e sem reabertura conhecida: aguardando.
    expect(estadoParaParticipante(g, false, null, null)).toBe("aguardando");
    expect(estadoParaParticipante(g, false, { entrouEm: 1 }, null)).toBe("aguardando");
  });
  test("o banner de removido some com o grupo reaberto", () => {
    const ps = [p({ removido: true, removidoNaRodada: 1 })];
    expect(bannerRemovidoAposSorteio("sorteado", 1, ps)).toBe(true);
    expect(bannerRemovidoAposSorteio("aberto", 1, ps)).toBe(false);
  });
  test("textos de remoção e banner contam rodadas por abertura", () => {
    expect(textoRemocao(1, 0, "aberto")).toBe("A pessoa sai do grupo e as respostas do perfil dela são apagadas.");
    expect(textoRemocao(4, 3, "sorteado")).toContain("exige refazer o sorteio");
    expect(textoRemocao(6, 3, "sorteado")).toContain("limite de 3 sorteios");
    expect(textoBannerRemovido(4, 3)).toContain("Refaça o sorteio");
    expect(textoBannerRemovido(6, 3)).not.toContain("Refaça");
  });
});
