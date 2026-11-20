import { describe, expect, test } from "bun:test";
import { TEMAS, camposIniciais } from "./temas";

const tema = (id: string) => TEMAS.find((t) => t.id === id)!;

describe("temas", () => {
  test("livro tem os 4 campos na ordem certa", () => {
    const c = camposIniciais("livro");
    expect(c.map((x) => [x.rotulo, x.tipo, x.obrigatorio])).toEqual([
      ["Livros que li recentemente", "lista", false],
      ["Gêneros que mais gosto", "multipla", true],
      ["Livros que já tenho / não quero ganhar", "lista", false],
      ["Observações para quem me tirar", "texto-longo", false],
    ]);
    expect(c[1]!.opcoes).toEqual(["fantasia", "romance", "suspense", "não ficção", "clássicos", "poesia", "infantil", "biografia"]);
    expect(c.some((x) => /desejos/i.test(x.rotulo))).toBe(false);
  });
  test("livre", () => {
    expect(camposIniciais("livre").map((x) => [x.rotulo, x.tipo, x.obrigatorio])).toEqual([
      ["Do que eu gosto", "texto-longo", true],
      ["Lista de desejos", "lista", false],
    ]);
  });
  test("vinho", () => {
    const c = camposIniciais("vinho");
    expect(c.map((x) => [x.rotulo, x.tipo, x.obrigatorio])).toEqual([
      ["Tipos de vinho que prefiro", "multipla", true],
      ["Uvas ou regiões favoritas", "lista", false],
      ["Observações", "texto-longo", false],
    ]);
    expect(c[0]!.opcoes).toEqual(["tinto", "branco", "rosé", "espumante", "sobremesa"]);
  });
  test("personalizado é vazio", () => {
    expect(camposIniciais("personalizado")).toEqual([]);
    expect(tema("personalizado").campos).toEqual([]);
  });
  test("ordens são sequenciais e camposIniciais devolve cópia", () => {
    for (const t of TEMAS) expect(t.campos.map((c) => c.ordem)).toEqual(t.campos.map((_, i) => i + 1));
    camposIniciais("livro")[1]!.opcoes!.push("x");
    expect(tema("livro").campos[1]!.opcoes).not.toContain("x");
  });
});
