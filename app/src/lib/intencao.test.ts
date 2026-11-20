import { describe, expect, test } from "bun:test";
import { consumirIntencao, destinoAposLogin, guardarIntencao, intencaoDaRota } from "./intencao";

function storageEmMemoria(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

describe("intenção através do login", () => {
  test("guardar e consumir devolve a intenção; o segundo consumo devolve null", () => {
    const s = storageEmMemoria();
    guardarIntencao({ tipo: "entrar", codigo: "KQ7M4P" }, s);
    expect(consumirIntencao(s)).toEqual({ tipo: "entrar", codigo: "KQ7M4P" });
    expect(consumirIntencao(s)).toBeNull();
  });

  test("sem nada guardado devolve null", () => {
    expect(consumirIntencao(storageEmMemoria())).toBeNull();
  });

  test("valor corrompido no storage é descartado", () => {
    const s = storageEmMemoria();
    s.setItem("amigo:intencao", "{lixo");
    expect(consumirIntencao(s)).toBeNull();
    s.setItem("amigo:intencao", JSON.stringify({ tipo: "hackear" }));
    expect(consumirIntencao(s)).toBeNull();
    expect(s.length).toBe(0);
  });

  test("destinoAposLogin cobre os 4 casos", () => {
    expect(destinoAposLogin({ tipo: "criar" })).toBe("/criar");
    expect(destinoAposLogin({ tipo: "entrar", codigo: "KQ7M4P" })).toBe("/g/KQ7M4P");
    expect(destinoAposLogin({ tipo: "entrar" })).toBe("/entrar-grupo");
    expect(destinoAposLogin(null)).toBe("/grupos");
  });

  test("código com caracteres estranhos é codificado na URL", () => {
    expect(destinoAposLogin({ tipo: "entrar", codigo: "a/b?c" })).toBe("/g/a%2Fb%3Fc");
  });
});

describe("intencaoDaRota", () => {
  test("rotas internas viram intenção; o resto, null", () => {
    expect(intencaoDaRota("/criar")).toEqual({ tipo: "criar" });
    expect(intencaoDaRota("/entrar-grupo")).toEqual({ tipo: "entrar" });
    expect(intencaoDaRota("/g/KQ7-M4P")).toEqual({ tipo: "entrar", codigo: "KQ7-M4P" });
    expect(intencaoDaRota("/g/KQ7%20M4P/")).toEqual({ tipo: "entrar", codigo: "KQ7 M4P" });
    expect(intencaoDaRota("/grupos")).toBeNull();
    expect(intencaoDaRota("/conta")).toBeNull();
  });

  test("ida e volta: rota -> intenção -> destino", () => {
    for (const r of ["/criar", "/entrar-grupo", "/g/KQ7M4P"]) {
      expect(destinoAposLogin(intencaoDaRota(r))).toBe(r);
    }
  });
});
