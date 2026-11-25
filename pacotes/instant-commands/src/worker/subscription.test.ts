import { describe, expect, test } from "bun:test";
import type { Command } from "../command";
import type { Engine } from "./engine";
import type { RunnerEvent } from "./execution";
import { instantSubscription, startSubscription, startSubscriptionTrigger, type Subscription } from "./subscription";

type Item = { id: string };

/** Controllable fake subscription: records every opening and lets the test deliver or fail. */
function fake() {
  const openings: { deliver: (i: Item[]) => void; fail: (e: unknown) => void; closed: boolean }[] = [];
  const subscribe: Subscription<Item> = (deliver, fail) => {
    const o = { deliver, fail, closed: false };
    openings.push(o);
    return { close: () => void (o.closed = true) };
  };
  return { openings, subscribe };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup(f: ReturnType<typeof fake>, extra: Partial<Parameters<typeof startSubscription>[0]> = {}) {
  const received: string[][] = [];
  const events: RunnerEvent[] = [];
  const sub = startSubscription({
    name: "test",
    subscribe: f.subscribe,
    onItems: async (ids) => void received.push(ids),
    backoffMs: [10, 20],
    emit: (e) => events.push(e),
    ...extra,
  });
  return { sub, received, events };
}

describe("startSubscription", () => {
  test("a delivery of [a,b] calls onItems once with both ids and emits delivery", async () => {
    const f = fake();
    const { sub, received, events } = setup(f);
    f.openings[0]!.deliver([{ id: "a" }, { id: "b" }]);
    await wait(5);
    expect(received).toEqual([["a", "b"]]);
    expect(events.filter((e) => e.type === "delivery")).toEqual([{ type: "delivery", command: "test", count: 2 }]);
    expect(events.some((e) => e.type === "subscribed")).toBe(true);
    sub.stop();
  });

  test("an error closes and resubscribes after 10 ms, then 20 ms; items after reconnection are delivered", async () => {
    const f = fake();
    const { sub, received, events } = setup(f);
    f.openings[0]!.fail(new Error("x"));
    expect(f.openings[0]!.closed).toBe(true);
    expect(f.openings.length).toBe(1);
    await wait(40);
    expect(f.openings.length).toBe(2);
    f.openings[1]!.fail(new Error("y"));
    await wait(8);
    expect(f.openings.length).toBe(2);
    await wait(40);
    expect(f.openings.length).toBe(3);
    expect(f.openings[1]!.closed).toBe(true);
    f.openings[2]!.deliver([{ id: "p" }]);
    await wait(5);
    expect(received).toEqual([["p"]]);
    expect(events.filter((e) => e.type === "resubscribed").length).toBe(2);
    expect(events.filter((e) => e.type === "subscription.error").length).toBe(2);
    sub.stop();
  });

  test("backoff resets on the first successful delivery", async () => {
    const f = fake();
    const { sub } = setup(f);
    f.openings[0]!.fail(1);
    await wait(40);
    f.openings[1]!.fail(2);
    await wait(40);
    f.openings[2]!.deliver([]);
    f.openings[2]!.fail(3);
    await wait(15); // 10 ms (reset), not 20
    expect(f.openings.length).toBe(4);
    sub.stop();
  });

  test("repeated errors before resubscribing do not schedule duplicate resubscriptions", async () => {
    const f = fake();
    const { sub } = setup(f);
    f.openings[0]!.fail(1);
    f.openings[0]!.fail(2);
    await wait(60);
    expect(f.openings.length).toBe(2);
    sub.stop();
  });

  test("an onItems that rejects does not stop the subscription", async () => {
    const f = fake();
    const seen: string[][] = [];
    const { sub } = setup(f, {
      onItems: async (ids) => {
        seen.push(ids);
        if (ids[0] === "a") throw new Error("failed");
      },
    });
    f.openings[0]!.deliver([{ id: "a" }]);
    await wait(5);
    f.openings[0]!.deliver([{ id: "c" }]);
    await wait(5);
    expect(seen).toEqual([["a"], ["c"]]);
    expect(f.openings.length).toBe(1);
    sub.stop();
  });

  test("a subscribe that throws synchronously is treated as an error and resubscribes", async () => {
    let n = 0;
    const sub = startSubscription({
      name: "t",
      subscribe: () => {
        if (++n === 1) throw new Error("no network");
        return { close() {} };
      },
      onItems: async () => {},
      backoffMs: [10],
      emit: () => {},
    });
    await wait(40);
    expect(n).toBe(2);
    sub.stop();
  });

  test("stop() closes the subscription, stops resubscribing and ignores late deliveries", async () => {
    const f = fake();
    const { sub, received } = setup(f);
    f.openings[0]!.fail(1);
    sub.stop();
    await wait(40);
    expect(f.openings.length).toBe(1);
    expect(f.openings[0]!.closed).toBe(true);
    f.openings[0]!.deliver([{ id: "z" }]);
    await wait(5);
    expect(received).toEqual([]);
  });

  test("stop() with an active subscription closes it", () => {
    const f = fake();
    const { sub } = setup(f);
    sub.stop();
    expect(f.openings[0]!.closed).toBe(true);
  });

  test("events carry only the error name, never message or item values", async () => {
    const f = fake();
    const { sub, events } = setup(f, {
      onItems: async () => {
        throw new Error("SECRET-NAME");
      },
    });
    f.openings[0]!.deliver([{ id: "a", secret: "SECRET-NAME" } as Item]);
    await wait(5);
    f.openings[0]!.fail(new TypeError("SECRET-NAME"));
    await wait(30);
    sub.stop();
    expect(JSON.stringify(events)).not.toContain("SECRET-NAME");
    expect(events.filter((e) => e.type === "subscription.error").map((e) => e.error)).toEqual(["Error", "TypeError"]);
  });
});

describe("instantSubscription", () => {
  test("flattens ids of every entity and forwards errors", () => {
    let cb!: (p: any) => void;
    let closed = false;
    const db = {
      subscribeQuery: (_q: unknown, c: (p: any) => void) => {
        cb = c;
        return { close: () => void (closed = true) };
      },
    };
    const got: string[][] = [];
    const errs: unknown[] = [];
    const s = instantSubscription(db, { a: {}, b: {} })(
      (items) => got.push(items.map((i) => i.id)),
      (e) => errs.push(e),
    );
    cb({ type: "ok", data: { a: [{ id: "1" }], b: [{ id: "2" }, { id: "3" }] } });
    cb({ type: "error", error: "boom" });
    expect(got).toEqual([["1", "2", "3"]]);
    expect(errs).toEqual(["boom"]);
    s.close();
    expect(closed).toBe(true);
  });
});

describe("startSubscriptionTrigger", () => {
  const cmd = (name: string, entity: string) => ({ name, entity }) as unknown as Command;

  function makeDb() {
    const subs: { query: any; cb: (p: any) => void; closed: boolean }[] = [];
    const db = {
      subscribeQuery: (query: any, cb: (p: any) => void) => {
        const s = { query, cb, closed: false };
        subs.push(s);
        return { close: () => void (s.closed = true) };
      },
    };
    return { db, subs };
  }

  test("subscribes per command entity and dispatches each delivered id; a failing id does not stop others", async () => {
    const { db, subs } = makeDb();
    const dispatched: [string, string][] = [];
    const engine = {
      dispatch: async (n: string, id: string) => {
        if (id === "bad") throw new Error("detail");
        dispatched.push([n, id]);
      },
    } as unknown as Engine;
    const events: RunnerEvent[] = [];
    const t = startSubscriptionTrigger(
      db as any,
      engine,
      [cmd("c1", "e1"), cmd("c2", "e2")],
      { resubscribeEveryMs: 10_000 },
      (e) => events.push(e),
    );
    expect(subs.map((s) => s.query)).toEqual([
      { e1: { $: { where: { status: { $in: ["pending", "running"] } } } } },
      { e2: { $: { where: { status: { $in: ["pending", "running"] } } } } },
    ]);
    subs[0]!.cb({ type: "ok", data: { e1: [{ id: "bad" }, { id: "x" }] } });
    subs[1]!.cb({ type: "ok", data: { e2: [{ id: "y" }] } });
    await wait(10);
    expect(dispatched.sort()).toEqual([
      ["c1", "x"],
      ["c2", "y"],
    ]);
    const failure = events.find((e) => e.type === "run.failed");
    expect(Object.keys(failure!).sort()).toEqual(["error", "type"]);
    t.stop();
  });

  test("resubscribes every resubscribeEveryMs", async () => {
    const { db, subs } = makeDb();
    const events: RunnerEvent[] = [];
    const t = startSubscriptionTrigger(
      db as any,
      { dispatch: async () => {} } as unknown as Engine,
      [cmd("c1", "e1")],
      { resubscribeEveryMs: 30 },
      (e) => events.push(e),
    );
    expect(subs.length).toBe(1);
    await wait(80);
    expect(subs.length).toBeGreaterThanOrEqual(2);
    expect(subs[0]!.closed).toBe(true);
    expect(events.some((e) => e.type === "resubscribed")).toBe(true);
    t.stop();
    const n = subs.length;
    expect(subs.every((s) => s.closed)).toBe(true);
    await wait(60);
    expect(subs.length).toBe(n);
  });
});
