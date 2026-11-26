import { describe, expect, test } from "bun:test";
import type { RunnerEvent } from "instant-commands/worker";
import { camposDoEvento, classeDoErro } from "./logEvento";

describe("camposDoEvento", () => {
  test("run.failed: só a classe do erro, nunca o texto", () => {
    const e = { type: "run.failed", command: "sorteio", commandId: "abc", error: "TypeError: dado de maria@exemplo.com" } as unknown as RunnerEvent;
    const c = camposDoEvento(e);
    expect(c.erroClasse).toBe("TypeError");
    expect(c.error).toBeUndefined();
    expect(JSON.stringify(c)).not.toContain("maria");
    expect(c.commandId).toBe("abc");
  });

  test("erro sem classe reconhecível vira desconhecido", () => {
    expect(classeDoErro("falhou com joao@x.com")).toBe("desconhecido");
  });

  test("command.failed mantém a mensagem fixa; arrays viram lista e undefined some", () => {
    const e = { type: "command.failed", command: "sorteio", commandId: "abc", error: "Rodada inválida", fields: ["a", "b"], x: undefined } as unknown as RunnerEvent;
    expect(camposDoEvento(e)).toEqual({ type: "command.failed", command: "sorteio", commandId: "abc", error: "Rodada inválida", fields: "a,b" });
  });
});
