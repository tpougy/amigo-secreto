import { describe, expect, test } from "bun:test";
import { codigoDeQR, destinoAoAbrirCodigo, erroDeEntrada } from "./navegacao";

const g = (status: string) => ({ id: "g1", status });

describe("destinoAoAbrirCodigo", () => {
  test("não logado vai para o login (mesmo com grupo)", () => {
    expect(destinoAoAbrirCodigo({ logado: false, grupo: g("aberto"), souMembro: false })).toEqual({ tipo: "login" });
    expect(destinoAoAbrirCodigo({ logado: false, grupo: null, souMembro: false })).toEqual({ tipo: "login" });
  });
  test("grupo nulo: não encontrado", () => {
    expect(destinoAoAbrirCodigo({ logado: true, grupo: null, souMembro: false })).toEqual({ tipo: "nao-encontrado" });
  });
  test("membro vai direto para o grupo, qualquer status", () => {
    for (const s of ["aberto", "sorteado", "encerrado"]) {
      expect(destinoAoAbrirCodigo({ logado: true, grupo: g(s), souMembro: true })).toEqual({
        tipo: "ir-para-grupo",
        id: "g1",
      });
    }
  });
  test("não membro: sorteado, encerrado e aberto", () => {
    expect(destinoAoAbrirCodigo({ logado: true, grupo: g("sorteado"), souMembro: false })).toEqual({ tipo: "ja-sorteado" });
    expect(destinoAoAbrirCodigo({ logado: true, grupo: g("encerrado"), souMembro: false })).toEqual({ tipo: "encerrado" });
    expect(destinoAoAbrirCodigo({ logado: true, grupo: g("aberto"), souMembro: false })).toEqual({ tipo: "previa" });
  });
});

describe("codigoDeQR", () => {
  test("URL, código puro e lixo", () => {
    expect(codigoDeQR("https://amigo.tpou.gy/g/KQ7M4P")).toBe("KQ7M4P");
    expect(codigoDeQR("https://amigo.tpou.gy/g/kq7-m4p?x=1")).toBe("KQ7M4P");
    expect(codigoDeQR("KQ7M4P")).toBe("KQ7M4P");
    expect(codigoDeQR("https://exemplo.com/")).toBeNull();
    expect(codigoDeQR("KQ0M4P")).toBeNull();
  });
});

describe("erroDeEntrada", () => {
  const e = (type: string) => ({ body: { type } });
  test("mapeia os erros do Instant", () => {
    expect(erroDeEntrada(e("rate-limited")).mensagem).toBe("Muitas tentativas. Tente de novo em alguns minutos");
    expect(erroDeEntrada(e("record-not-unique"))).toEqual({ mensagem: "Você já está neste grupo", irParaGrupo: true });
    expect(erroDeEntrada(e("permission-denied")).mensagem).toBe("Não foi possível entrar (o grupo pode estar fechado)");
    expect(erroDeEntrada(new Error("x")).irParaGrupo).toBe(false);
  });
});
