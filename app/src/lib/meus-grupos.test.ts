import { describe, expect, test } from "bun:test";
import { separarGrupos } from "./meus-grupos";

const g = (id: string, criadoEm: number, status = "aberto") => ({ id, titulo: id, status, criadoEm });

describe("separarGrupos", () => {
  test("organizador aparece só em Organizando; removido some; ordem do mais novo", () => {
    const r = separarGrupos(
      [g("o1", 1), g("o2", 3)],
      [
        { removido: false, grupo: g("o1", 1) },
        { removido: false, grupo: g("p1", 2, "sorteado") },
        { removido: true, grupo: g("p2", 5) },
        { removido: false, grupo: g("p3", 4) },
        { removido: false, grupo: null },
      ],
    );
    expect(r.organizando.map((x) => x.id)).toEqual(["o2", "o1"]);
    expect(r.participando.map((x) => x.id)).toEqual(["p3", "p1"]);
  });

  test("sem nada: duas listas vazias", () => {
    expect(separarGrupos([], [])).toEqual({ organizando: [], participando: [] });
  });

  test("datas em ISO também ordenam", () => {
    const r = separarGrupos(
      [
        { id: "a", titulo: "a", status: "aberto", criadoEm: "2026-01-01T00:00:00Z" },
        { id: "b", titulo: "b", status: "aberto", criadoEm: "2026-06-01T00:00:00Z" },
      ],
      [],
    );
    expect(r.organizando.map((x) => x.id)).toEqual(["b", "a"]);
  });
});
