// Unit tests of the step-limit branch of registerHandler, with a fake engine and a fake db.
import { describe, expect, mock, test } from "bun:test";
import { sortear } from "../../testes/app/commands";
import { registerHandler, type RunnerEvent } from "./execution";
import { defineHandler } from "./handler";

const open = { id: "c1", status: "running", chave: "k", rodada: 1 };
const stepLimit = () => Object.assign(new Error("step limit exceeded"), { name: "StepLimitExceededError" });

function setup(transact: (chunks: unknown[]) => Promise<unknown>, withHook: boolean, status = "running") {
  const db = { query: async () => ({ sorteios: [{ ...open, status }] }), transact: mock(transact) } as any;
  let workflow: ((ctx: any) => Promise<unknown>) | undefined;
  const engine = { define: (_n: string, _v: unknown, fn: any) => (workflow = fn) } as any;
  const events: RunnerEvent[] = [];
  const hook = mock(async ({ db }: any) => [db.tx.sorteios["c1"].update({ chave: null })]);
  const handler = defineHandler(sortear, async () => {}, withHook ? { onFailure: hook as any } : {});
  registerHandler(engine, db, handler as any, (e) => events.push(e));
  db.tx = { sorteios: { c1: { update: (v: unknown) => ({ __ops: [["update", "sorteios", "c1", v]] }) } } };
  const error = stepLimit();
  const run = () =>
    workflow!({
      input: { commandId: "c1" },
      step: {
        run: async () => {
          throw error;
        },
      },
    });
  return { db, events, run, error, hook };
}

const errors = (events: RunnerEvent[]) => events.filter((e) => e.type === "run.failed").map((e) => e.error);
const failedEvents = (events: RunnerEvent[]) => events.filter((e) => e.type === "command.failed");
const DEFAULT = "Could not complete the command";

describe("step limit", () => {
  test("writes failed + the hook's chunks once and rethrows the original error", async () => {
    const { db, events, run, error } = setup(async () => ({}), true);
    await expect(run()).rejects.toBe(error);
    expect(db.transact).toHaveBeenCalledTimes(1);
    expect(db.transact.mock.calls[0]![0]).toHaveLength(2);
    expect(errors(events)).toEqual(["step limit exceeded"]);
    expect(failedEvents(events)).toEqual([{ type: "command.failed", command: "sortear", commandId: "c1", error: DEFAULT }]);
  });

  test("a non-4xx error with the hook's chunks falls back to failed alone and rethrows the original", async () => {
    let calls = 0;
    const { db, events, run, error } = setup(async () => {
      if (calls++ === 0) throw new Error("fetch failed");
      return {};
    }, true);
    await expect(run()).rejects.toBe(error);
    expect(db.transact).toHaveBeenCalledTimes(2);
    expect(db.transact.mock.calls[1]![0]).toHaveLength(1);
    expect(JSON.stringify(db.transact.mock.calls[1]![0])).toContain('"status":"failed"');
    expect(errors(events)).toEqual(["fetch failed", "step limit exceeded"]);
    expect(failedEvents(events)).toEqual([{ type: "command.failed", command: "sortear", commandId: "c1", error: DEFAULT }]);
  });

  test("rethrows the original error even when the fallback write fails too", async () => {
    const { events, run, error } = setup(async () => {
      throw new Error("fetch failed");
    }, true);
    await expect(run()).rejects.toBe(error);
    expect(errors(events)).toEqual(["fetch failed", "fetch failed"]);
    expect(failedEvents(events)).toHaveLength(0);
  });

  test("without a hook, a failing write still rethrows the original error", async () => {
    const { events, run, error } = setup(async () => {
      throw new Error("fetch failed");
    }, false);
    await expect(run()).rejects.toBe(error);
    expect(errors(events)).toEqual(["fetch failed", "fetch failed"]);
    expect(failedEvents(events)).toHaveLength(0);
  });

  test("already failed → no command.failed", async () => {
    const { db, events, run, error } = setup(async () => ({}), true, "failed");
    await expect(run()).rejects.toBe(error);
    expect(db.transact).not.toHaveBeenCalled();
    expect(failedEvents(events)).toHaveLength(0);
  });
});
