import { describe, expect, test } from "bun:test";
import { atualizarContagem, ehGrupoDeTeste, textoContador } from "./estatisticas";

describe("atualizarContagem", () => {
  test("sem registro anterior: conta todos os grupos existentes", () => {
    expect(atualizarContagem(null, [30, 10, 20])).toEqual({ gruposOrganizados: 3, contadoAte: 30 });
  });

  test("sem grupos e sem registro: zero, contadoAte 0", () => {
    expect(atualizarContagem(null, [])).toEqual({ gruposOrganizados: 0, contadoAte: 0 });
  });

  test("com registro: soma só os criados depois de contadoAte", () => {
    expect(atualizarContagem({ gruposOrganizados: 5, contadoAte: 20 }, [10, 20, 25, 40])).toEqual({
      gruposOrganizados: 7,
      contadoAte: 40,
    });
  });

  test("grupos apagados não diminuem o total; sem novos, nada muda", () => {
    expect(atualizarContagem({ gruposOrganizados: 5, contadoAte: 20 }, [10])).toEqual({
      gruposOrganizados: 5,
      contadoAte: 20,
    });
  });

  test("rodar duas vezes com o mesmo estado dá o mesmo resultado (idempotente)", () => {
    const a = atualizarContagem({ gruposOrganizados: 1, contadoAte: 5 }, [5, 6, 7]);
    expect(atualizarContagem(a, [5, 6, 7])).toEqual(a);
  });
});

test("ehGrupoDeTeste: só título começando com e2e-", () => {
  expect(ehGrupoDeTeste("e2e-1795 grupo")).toBe(true);
  expect(ehGrupoDeTeste("Família e2e-")).toBe(false);
});

test("textoContador: pt-BR, singular e plural", () => {
  expect(textoContador(1)).toEqual({ numero: "1", rotulo: "amigo secreto já organizado" });
  expect(textoContador(0)).toEqual({ numero: "0", rotulo: "amigos secretos já organizados" });
  expect(textoContador(1234)).toEqual({ numero: "1.234", rotulo: "amigos secretos já organizados" });
});
