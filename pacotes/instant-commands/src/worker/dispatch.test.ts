import { expect, test } from "bun:test";
import type { Command } from "../command";
import { sweep } from "./dispatch";
import type { Engine } from "./engine";
import type { RunnerEvent } from "./execution";

const cmd = (name: string, entity: string) => ({ name, entity }) as unknown as Command;

function setup(opts: { failingEntity?: string; failingId?: string }) {
  const dispatched: [string, string][] = [];
  const events: RunnerEvent[] = [];
  const db = {
    query: async (q: Record<string, unknown>) => {
      const entity = Object.keys(q)[0]!;
      if (entity === opts.failingEntity) throw new Error("query exploded");
      return { [entity]: [{ id: `${entity}-1` }, { id: `${entity}-2` }] };
    },
  } as any;
  const engine = {
    dispatch: async (name: string, id: string) => {
      if (id === opts.failingId) throw new Error("engine down");
      dispatched.push([name, id]);
    },
  } as unknown as Engine;
  return { db, engine, dispatched, events, emit: (e: RunnerEvent) => events.push(e) };
}

test("a failing entity query does not stop the other entities", async () => {
  const s = setup({ failingEntity: "as" });
  const count = await sweep(s.db, s.engine, [cmd("a", "as"), cmd("b", "bs")], s.emit);
  expect(count).toBe(2);
  expect(s.dispatched).toEqual([
    ["b", "bs-1"],
    ["b", "bs-2"],
  ]);
  expect(s.events).toEqual([
    { type: "run.failed", command: "a", error: "query exploded" },
    { type: "sweep", count: 2 },
  ]);
});

test("a failing dispatch is reported with the command and its id", async () => {
  const s = setup({ failingId: "as-1" });
  const count = await sweep(s.db, s.engine, [cmd("a", "as")], s.emit);
  expect(count).toBe(1);
  expect(s.events[0]).toEqual({ type: "run.failed", command: "a", commandId: "as-1", error: "engine down" });
});
