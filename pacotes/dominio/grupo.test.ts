import { expect, test } from "bun:test";
import { temOpcoes, validarCamposEditados, validarDadosGrupo } from "./grupo";

const base = { titulo: "Amigo da firma", descricao: "", dataSorteio: "", dataEvento: "", valor: null };

test("validarDadosGrupo: título, descrição, datas e valor", () => {
  expect(validarDadosGrupo(base)).toEqual([]);
  expect(validarDadosGrupo({ ...base, titulo: "ab" })).toEqual(["O título precisa ter de 3 a 80 caracteres."]);
  expect(validarDadosGrupo({ ...base, descricao: "x".repeat(501) })).toHaveLength(1);
  expect(validarDadosGrupo({ ...base, dataSorteio: "2026-12-20", dataEvento: "2026-12-10" })).toEqual([
    "A data do evento não pode ser anterior à data prevista do sorteio.",
  ]);
  expect(validarDadosGrupo({ ...base, valor: -1 })).toHaveLength(1);
  expect(validarDadosGrupo({ ...base, valor: Number.NaN })).toHaveLength(1);
});

test("validarCamposEditados: rótulo e opções", () => {
  expect(validarCamposEditados([{ rotulo: "Cor", tipo: "unica", opcoes: ["azul", "verde"] }])).toEqual([]);
  expect(validarCamposEditados([{ rotulo: " ", tipo: "texto-curto", opcoes: [] }])).toEqual(["Campo 1: informe o rótulo."]);
  expect(validarCamposEditados([{ rotulo: "Cor", tipo: "multipla", opcoes: ["azul", " "] }])).toEqual([
    "Campo 1 (Cor): informe pelo menos 2 opções.",
  ]);
  expect(temOpcoes("lista")).toBe(false);
});

test("datas: dia ↔ ISO sem trocar de dia", async () => {
  const { diaParaIso, isoParaDia } = await import("./grupo");
  expect(isoParaDia(diaParaIso("2026-12-24"))).toBe("2026-12-24");
  expect(isoParaDia(null)).toBe("");
});
