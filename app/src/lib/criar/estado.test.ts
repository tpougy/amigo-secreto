import { describe, expect, test } from "bun:test";
import {
  apelidoDoEmail,
  estadoInicial,
  ehColisao,
  paraTransacao,
  trocarTema,
  validarEtapa,
  validarTudo,
  type Ids,
} from "./estado.svelte";

const base = () => ({ ...estadoInicial("livro"), titulo: "Amigo Secreto da Família" });

describe("validarEtapa", () => {
  test("recusa título de 2 caracteres e aceita 3", () => {
    expect(validarEtapa(1, { ...base(), titulo: "ab" })).toHaveLength(1);
    expect(validarEtapa(1, { ...base(), titulo: " ab " })).toHaveLength(1);
    expect(validarEtapa(1, { ...base(), titulo: "abc" })).toEqual([]);
  });
  test("título longo demais e descrição com mais de 500", () => {
    expect(validarEtapa(1, { ...base(), titulo: "x".repeat(81) })).toHaveLength(1);
    expect(validarEtapa(1, { ...base(), descricao: "x".repeat(501) })).toHaveLength(1);
    expect(validarEtapa(1, { ...base(), descricao: "x".repeat(500) })).toEqual([]);
  });
  test("recusa o evento antes do sorteio; datas opcionais", () => {
    expect(validarEtapa(2, { ...base(), dataSorteio: "2026-12-20", dataEvento: "2026-12-10" })).toHaveLength(1);
    expect(validarEtapa(2, { ...base(), dataSorteio: "2026-12-10", dataEvento: "2026-12-10" })).toEqual([]);
    expect(validarEtapa(2, { ...base(), dataEvento: "2026-12-10" })).toEqual([]);
    expect(validarEtapa(2, base())).toEqual([]);
  });
  test("valor sugerido: vazio ok, 0 ok, negativo e lixo não", () => {
    expect(validarEtapa(2, { ...base(), valor: "" })).toEqual([]);
    expect(validarEtapa(2, { ...base(), valor: "0" })).toEqual([]);
    expect(validarEtapa(2, { ...base(), valor: "50,5" })).toEqual([]);
    expect(validarEtapa(2, { ...base(), valor: "-1" })).toHaveLength(1);
    expect(validarEtapa(2, { ...base(), valor: "abc" })).toHaveLength(1);
  });
  test("campos: rótulo obrigatório e 2 opções em múltipla/única", () => {
    const e = base();
    expect(validarEtapa(3, e)).toEqual([]);
    e.campos[0]!.rotulo = "  ";
    e.campos[1]!.opcoes = ["só uma"];
    expect(validarEtapa(3, e)).toHaveLength(2);
    expect(validarTudo(e)?.etapa).toBe(3);
  });
});

describe("trocarTema", () => {
  test("livro preenche os 4 campos; personalizado esvazia", () => {
    const e = trocarTema(estadoInicial("personalizado"), "livro");
    expect(e.campos).toHaveLength(4);
    expect(e.temaId).toBe("livro");
    expect(e.campos[1]!.opcoes.length).toBeGreaterThan(1);
    expect(trocarTema(e, "personalizado").campos).toHaveLength(0);
  });
  test("zera camposEditados", () => {
    const e = { ...base(), camposEditados: true };
    expect(trocarTema(e, "vinho").camposEditados).toBe(false);
  });
});

describe("paraTransacao", () => {
  const ids = (n: number): Ids => ({
    grupoId: "g1",
    codigo: "KQ7M4P",
    participanteId: "p1",
    campoIds: Array.from({ length: n }, (_, i) => `c${i}`),
    usuarioId: "u1",
    apelido: "fulano",
    agora: 1_700_000_000_000,
  });
  test("1 grupo, N campos com ordem 0..N-1 e 1 participante", () => {
    const e = { ...base(), valor: "50", dataSorteio: "2026-12-10" };
    const ops = paraTransacao(e, ids(4));
    expect(ops.filter((o) => o.entidade === "grupos")).toHaveLength(1);
    expect(ops.filter((o) => o.entidade === "participantes")).toHaveLength(1);
    const campos = ops.filter((o) => o.entidade === "campos");
    expect(campos.map((c) => c.dados.ordem)).toEqual([0, 1, 2, 3]);
    expect(campos.every((c) => c.links.grupo === "g1")).toBe(true);
    const g = ops[0]!;
    expect(g.dados).toMatchObject({ status: "aberto", rodadaAtual: 0, codigo: "KQ7M4P", valorSugerido: 50, tema: "livro" });
    expect(g.links).toEqual({ organizador: "u1" });
    expect(g.dados.dataEvento).toBeUndefined();
    const p = ops.at(-1)!;
    expect(p.dados).toMatchObject({ chave: "g1:u1", perfilCompleto: false, removido: false, apelido: "fulano" });
    expect(p.links).toEqual({ grupo: "g1", usuario: "u1" });
  });
  test("opções só em múltipla/única", () => {
    const ops = paraTransacao(base(), ids(4));
    const campos = ops.filter((o) => o.entidade === "campos");
    expect(campos[0]!.dados.opcoes).toBeUndefined();
    expect(Array.isArray(campos[1]!.dados.opcoes)).toBe(true);
  });
});

test("apelidoDoEmail", () => {
  expect(apelidoDoEmail("thomaz@x.com")).toBe("thomaz");
  expect(apelidoDoEmail(null)).toBe("Organizador");
});

test("ehColisao", () => {
  expect(ehColisao({ body: { type: "record-not-unique" } })).toBe(true);
  expect(ehColisao(new Error("x"))).toBe(false);
});
