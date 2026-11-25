import { describe, expect, test } from "bun:test";
import { CommandInputError } from "./errors";
import { sendCommand, subscribeCommand, waitForCommand, type ClientDb } from "./client";
import { reabrir, sortear } from "../testes/app/commands";

type Chunk = { __etype: string; __ops: [string, string, string, Record<string, unknown>][] };

function fakeDb() {
  const chunks: Chunk[] = [];
  let cb: ((r: any) => void) | undefined;
  let closed = 0;
  const db: ClientDb = {
    async transact(c) {
      chunks.push(...(Array.isArray(c) ? c : [c]));
      return {};
    },
    subscribeQuery(_q, fn) {
      cb = fn;
      return () => {
        closed++;
      };
    },
  };
  return { db, chunks, emit: (r: unknown) => cb!(r), closed: () => closed };
}

const GRUPO = "11111111-1111-1111-1111-111111111111";

describe("sendCommand", () => {
  test("validates before writing", async () => {
    const f = fakeDb();
    // @ts-expect-error missing required fields
    await expect(sendCommand(f.db, sortear, { grupo: GRUPO })).rejects.toBeInstanceOf(CommandInputError);
    expect(f.chunks).toHaveLength(0);
  });

  test("writes pending, attempts 0, createdAt and links", async () => {
    const f = fakeDb();
    const before = Date.now();
    const cid = await sendCommand(f.db, sortear, { rodada: 1, chave: "k", grupo: GRUPO });
    expect(f.chunks).toHaveLength(1);
    const [update, link] = f.chunks[0]!.__ops;
    expect(f.chunks[0]!.__etype).toBe("sorteios");
    expect(update![0]).toBe("update");
    expect(update![2]).toBe(cid);
    expect(update![3]).toMatchObject({ status: "pending", attempts: 0, rodada: 1, chave: "k" });
    expect(update![3].createdAt as number).toBeGreaterThanOrEqual(before);
    expect(update![3]).not.toHaveProperty("grupo");
    expect(link!.slice(0, 3)).toEqual(["link", "sorteios", cid]);
    expect(link![3]).toEqual({ grupo: GRUPO });
  });
});

const base = { id: "c1", status: "done", error: null, attempts: 1, createdAt: 10, finishedAt: 20 };

describe("subscribeCommand", () => {
  test("maps a record to CommandState (core payload) and unsubscribes", () => {
    const f = fakeDb();
    const seen: unknown[] = [];
    const off = subscribeCommand(f.db, sortear, "c1" as any, (s) => seen.push(s));
    f.emit({ data: { sorteios: [{ ...base, result: { pares: 3 } }] }, error: undefined });
    expect(seen[0]).toEqual({ ...base, result: { pares: 3 }, resultIssues: null });
    off();
    expect(f.closed()).toBe(1);
  });

  test("accepts the admin payload and a { close } handle", () => {
    const seen: unknown[] = [];
    let closed = false;
    const db: ClientDb = {
      async transact() {},
      subscribeQuery(_q, cb) {
        cb({ type: "ok", data: { reaberturas: [{ ...base, result: null }] } });
        return { close: () => void (closed = true) };
      },
    };
    const off = subscribeCommand(db, reabrir, "c1" as any, (s) => seen.push(s));
    expect(seen[0]).toMatchObject({ id: "c1", status: "done", result: null, resultIssues: null });
    off();
    expect(closed).toBe(true);
  });

  test("invalid stored result arrives as result null with resultIssues", () => {
    const f = fakeDb();
    const seen: any[] = [];
    subscribeCommand(f.db, sortear, "c1" as any, (s) => seen.push(s));
    f.emit({ data: { sorteios: [{ ...base, result: { pares: "x" } }] } });
    expect(seen[0].result).toBeNull();
    expect(seen[0].resultIssues.length).toBeGreaterThan(0);
  });

  test("missing record arrives as null", () => {
    const f = fakeDb();
    const seen: unknown[] = [];
    subscribeCommand(f.db, sortear, "c1" as any, (s) => seen.push(s));
    f.emit({ data: { sorteios: [] } });
    expect(seen).toEqual([null]);
  });

  test("ignores error payloads", () => {
    const f = fakeDb();
    const seen: unknown[] = [];
    subscribeCommand(f.db, sortear, "c1" as any, (s) => seen.push(s));
    f.emit({ error: { message: "x" } });
    f.emit({ type: "error", error: { message: "x" } });
    expect(seen).toEqual([]);
  });
});

describe("waitForCommand", () => {
  test("resolves on done, rejects when the command vanishes", async () => {
    const f = fakeDb();
    const p = waitForCommand(f.db, sortear, "c1" as any);
    f.emit({ data: { sorteios: [{ ...base, status: "running", finishedAt: null, result: null }] } });
    f.emit({ data: { sorteios: [{ ...base, result: { pares: 2 } }] } });
    expect((await p).result).toEqual({ pares: 2 });
    expect(f.closed()).toBe(1);

    const g = fakeDb();
    const q = waitForCommand(g.db, sortear, "c1" as any);
    g.emit({ data: { sorteios: [] } });
    await expect(q).rejects.toThrow(/no longer exists/);
  });

  test("rejects on timeout", async () => {
    const f = fakeDb();
    await expect(waitForCommand(f.db, sortear, "c1" as any, { timeoutMs: 50 })).rejects.toThrow(/timed out/i);
    expect(f.closed()).toBe(1);
  });
});
