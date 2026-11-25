import { describe, expect, test } from "bun:test";
import { CommandDefinitionError, CommandResultError } from "../errors";
import { sortear } from "../../testes/app/commands";
import { CommandFailure, defineHandler, failCommand, fail, completeChunk } from "./handler";

describe("fail", () => {
  test("fail throws CommandFailure", () => {
    expect(() => fail("nope")).toThrow(CommandFailure);
    try {
      fail("nope");
    } catch (e) {
      expect((e as Error).message).toBe("nope");
      expect((e as Error).name).toBe("CommandFailure");
    }
  });
});

describe("failCommand", () => {
  test("builds an update chunk with status failed, error and finishedAt", () => {
    const chunk = failCommand(sortear, "abc", "boom") as any;
    expect(chunk.__etype).toBe("sorteios");
    expect(chunk.__ops[0][0]).toBe("update");
    expect(chunk.__ops[0][3]).toMatchObject({ status: "failed", error: "boom" });
    expect(typeof chunk.__ops[0][3].finishedAt).toBe("number");
  });
});

describe("complete", () => {
  test("validates the result and builds a done chunk", () => {
    const chunk = completeChunk(sortear, "abc", { pares: 3 }) as any;
    expect(chunk.__ops[0][3]).toMatchObject({ status: "done", result: { pares: 3 }, error: null });
    expect(typeof chunk.__ops[0][3].finishedAt).toBe("number");
  });

  test("an invalid result throws CommandResultError", () => {
    expect(() => completeChunk(sortear, "abc", { pares: "3" } as any)).toThrow(CommandResultError);
  });
});

describe("defineHandler", () => {
  test("returns the command, fn and options", () => {
    const fn = async () => ({ pares: 1 });
    const h = defineHandler(sortear, fn, { version: "2", defaultErrorMessage: "x" });
    expect(h.command).toBe(sortear);
    expect(h.fn).toBe(fn);
    expect(h.options).toEqual({ version: "2", defaultErrorMessage: "x" });
    expect(defineHandler(sortear, fn).options).toEqual({});
  });

  test("keeps onFailure in options", () => {
    const onFailure = () => [];
    expect(defineHandler(sortear, async () => {}, { onFailure }).options.onFailure).toBe(onFailure);
  });

  test("rejects an onFailure that is not a function", () => {
    expect(() => defineHandler(sortear, async () => {}, { onFailure: "x" as any })).toThrow(CommandDefinitionError);
    try {
      defineHandler(sortear, async () => {}, { onFailure: 1 as any });
    } catch (e) {
      expect((e as CommandDefinitionError).problems).toEqual(["options.onFailure: must be a function"]);
    }
  });
});
