import { describe, expect, test } from "bun:test";
import { caminhoCapa, planoApagarConta, resumoPlano, type DadosConta } from "./conta";

const dados: DadosConta = {
  usuarioId: "u1",
  participacoes: [
    { participanteId: "p-aberto", grupoId: "g-aberto", rodadaAtual: 0, respostas: ["r3"] },
    { participanteId: "p-sorteado", grupoId: "g-sorteado", rodadaAtual: 2, respostas: ["r2", "r1"] },
    { participanteId: "p-meu", grupoId: "g-meu", rodadaAtual: 1, respostas: ["r9"] },
    { participanteId: "p-encerrado", grupoId: "g-encerrado", rodadaAtual: 1, respostas: [] },
  ],
  gruposOrganizados: ["g-meu", "g-meu2"],
};

describe("planoApagarConta", () => {
  test("ordem: anonimizar → apagar participações → apagar grupos → concluir → apagar usuário", () => {
    expect(planoApagarConta(dados)).toEqual([
      { tipo: "anonimizar", participanteId: "p-encerrado", grupoId: "g-encerrado", rodada: 1, respostas: [] },
      { tipo: "anonimizar", participanteId: "p-sorteado", grupoId: "g-sorteado", rodada: 2, respostas: ["r1", "r2"] },
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
        { participanteId: "a", grupoId: "ga", rodadaAtual: 0, respostas: [] },
        { participanteId: "b", grupoId: "gb", rodadaAtual: 3, respostas: [] },
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
});

test("caminhoCapa", () => {
  expect(caminhoCapa("g1")).toBe("grupos/g1/capa.jpg");
});
