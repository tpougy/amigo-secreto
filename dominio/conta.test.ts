import { describe, expect, test } from "bun:test";
import { caminhoCapa, planoApagarConta, resumoPlano, type DadosConta } from "./conta";

const dados: DadosConta = {
  usuarioId: "u1",
  participacoes: [
    { participanteId: "p-aberto", grupoId: "g-aberto", status: "aberto", rodadaAtual: 0, respostas: ["r3"] },
    { participanteId: "p-sorteado", grupoId: "g-sorteado", status: "sorteado", rodadaAtual: 2, respostas: ["r2", "r1"] },
    { participanteId: "p-meu", grupoId: "g-meu", status: "sorteado", rodadaAtual: 1, respostas: ["r9"] },
    { participanteId: "p-encerrado", grupoId: "g-encerrado", status: "encerrado", rodadaAtual: 1, respostas: [] },
  ],
  gruposOrganizados: ["g-meu", "g-meu2"],
};

describe("planoApagarConta", () => {
  test("ordem: anonimizar → apagar participações → apagar grupos → concluir → apagar usuário", () => {
    expect(planoApagarConta(dados)).toEqual([
      { tipo: "anonimizar", participanteId: "p-encerrado", grupoId: "g-encerrado", rodada: 1, rodadaBase: 0, respostas: [] },
      { tipo: "anonimizar", participanteId: "p-sorteado", grupoId: "g-sorteado", rodada: 2, rodadaBase: 0, respostas: ["r1", "r2"] },
      { tipo: "apagar-participacao", participanteId: "p-aberto", grupoId: "g-aberto" },
      { tipo: "apagar-grupo", grupoId: "g-meu" },
      { tipo: "apagar-grupo", grupoId: "g-meu2" },
      { tipo: "concluir-pedido" },
      { tipo: "apagar-usuario", usuarioId: "u1" },
    ]);
  });

  test("grupo sorteado e depois encerrado (rodadaAtual >= 1) é anonimizado; sem sorteio é apagado", () => {
    const ops = planoApagarConta({
      usuarioId: "u",
      participacoes: [
        { participanteId: "a", grupoId: "ga", status: "aberto", rodadaAtual: 0, respostas: [] },
        { participanteId: "b", grupoId: "gb", status: "encerrado", rodadaAtual: 3, respostas: [] },
      ],
      gruposOrganizados: [],
    });
    expect(ops.map((o) => o.tipo)).toEqual(["anonimizar", "apagar-participacao", "concluir-pedido", "apagar-usuario"]);
  });

  test("participação em grupo que a pessoa organiza só some com o grupo", () => {
    const ops = planoApagarConta(dados);
    expect(ops.some((o) => "participanteId" in o && o.participanteId === "p-meu")).toBe(false);
  });

  test("conta sem nada: só concluir e apagar o usuário", () => {
    expect(planoApagarConta({ usuarioId: "u", participacoes: [], gruposOrganizados: [] })).toEqual([
      { tipo: "concluir-pedido" },
      { tipo: "apagar-usuario", usuarioId: "u" },
    ]);
  });

  test("resumoPlano conta cada tipo", () => {
    expect(resumoPlano(planoApagarConta(dados))).toEqual({ anonimizadas: 2, semRefazer: 0, apagadas: 1, grupos: 2 });
  });

  test("resumoPlano conta os grupos sorteados que já não podem refazer (rodada 3)", () => {
    const d: DadosConta = {
      ...dados,
      participacoes: dados.participacoes.map((p) => (p.participanteId === "p-sorteado" ? { ...p, rodadaAtual: 3 } : p)),
    };
    expect(resumoPlano(planoApagarConta(d)).semRefazer).toBe(1);
  });

  test("grupo reaberto (aberto, rodada >= 1, sem pares): a participação é apagada, não anonimizada", () => {
    const ops = planoApagarConta({
      usuarioId: "u",
      participacoes: [{ participanteId: "r", grupoId: "gr", status: "aberto", rodadaAtual: 2, rodadaBase: 2, respostas: ["x"] }],
      gruposOrganizados: [],
    });
    expect(ops).toEqual([
      { tipo: "apagar-participacao", participanteId: "r", grupoId: "gr" },
      { tipo: "concluir-pedido" },
      { tipo: "apagar-usuario", usuarioId: "u" },
    ]);
    expect(resumoPlano(ops)).toEqual({ anonimizadas: 0, semRefazer: 0, apagadas: 1, grupos: 0 });
  });

  test("grupo reaberto e sorteado de novo é anonimizado, guardando a rodadaBase", () => {
    const ops = planoApagarConta({
      usuarioId: "u",
      participacoes: [{ participanteId: "s", grupoId: "gs", status: "sorteado", rodadaAtual: 3, rodadaBase: 2, respostas: [] }],
      gruposOrganizados: [],
    });
    expect(ops[0]).toEqual({ tipo: "anonimizar", participanteId: "s", grupoId: "gs", rodada: 3, rodadaBase: 2, respostas: [] });
  });

  test("semRefazer conta as rodadas desta abertura (rodada - rodadaBase >= 3)", () => {
    const plano = (rodadaAtual: number, rodadaBase?: number | null) =>
      resumoPlano(
        planoApagarConta({
          usuarioId: "u",
          participacoes: [{ participanteId: "s", grupoId: "gs", status: "sorteado", rodadaAtual, rodadaBase, respostas: [] }],
          gruposOrganizados: [],
        }),
      ).semRefazer;
    expect(plano(3, 2)).toBe(0); // 1 rodada depois de reabrir
    expect(plano(4, 2)).toBe(0);
    expect(plano(5, 2)).toBe(1); // 3 rodadas depois de reabrir
    expect(plano(3, null)).toBe(1); // grupo antigo sem rodadaBase
    expect(plano(3, undefined)).toBe(1);
  });
});

test("caminhoCapa", () => {
  expect(caminhoCapa("g1")).toBe("grupos/g1/capa.jpg");
});
