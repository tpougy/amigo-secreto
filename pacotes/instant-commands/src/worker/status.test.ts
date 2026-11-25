// Unit tests of markFailed with extras, against a fake db.
import { describe, expect, mock, test } from "bun:test";
import { sortear } from "../../testes/app/commands";
import { isInstantRejection, markFailed } from "./status";

function fakeDb(rows: Record<string, unknown>[], transact = mock(async (_: unknown) => ({}))) {
  const db = { query: async () => ({ sorteios: rows }), transact } as any;
  return { db, transact };
}

const open = { id: "c1", status: "running", chave: "k", rodada: 1 };
const rejection = () => Object.assign(new Error("not unique"), { name: "InstantAPIError", status: 400 });

describe("markFailed with extras", () => {
  test("calls extras with the stored record and writes failed + extras in ONE transact", async () => {
    const { db, transact } = fakeDb([open]);
    const extra = { extra: true };
    const extras = mock(async (_r: Record<string, any>) => [extra] as any[]);
    const res = await markFailed(db, sortear, "c1", "m", extras);
    expect(res).toEqual({ written: true });
    expect(extras).toHaveBeenCalledWith(open);
    expect(transact).toHaveBeenCalledTimes(1);
    const arg = transact.mock.calls[0]![0] as any[];
    expect(arg).toHaveLength(2);
    expect(JSON.stringify(arg[0])).toContain('"status":"failed"');
    expect(arg[1]).toBe(extra);
  });

  for (const [nome, rows] of [
    ["absent", []],
    ["done", [{ ...open, status: "done" }]],
    ["failed", [{ ...open, status: "failed" }]],
  ] as const) {
    test(`does not call extras when the command is ${nome}`, async () => {
      const { db, transact } = fakeDb([...rows]);
      const extras = mock(async () => []);
      expect(await markFailed(db, sortear, "c1", "m", extras)).toEqual({ written: false });
      expect(extras).not.toHaveBeenCalled();
      expect(transact).not.toHaveBeenCalled();
    });
  }

  test("extras that throws → failed written alone, extrasError 'onFailure: boom'", async () => {
    const { db, transact } = fakeDb([open]);
    const res = await markFailed(db, sortear, "c1", "m", async () => {
      throw new Error("boom");
    });
    expect(res).toEqual({ written: true, extrasError: "onFailure: boom" });
    expect(transact).toHaveBeenCalledTimes(1);
    expect(transact.mock.calls[0]![0] as any[]).toHaveLength(1);
  });

  test("extras that returns a non-array → failed alone, extrasError starts with 'onFailure: '", async () => {
    const { db, transact } = fakeDb([open]);
    const res = await markFailed(db, sortear, "c1", "m", (async () => undefined) as any);
    expect(res.written).toBe(true);
    expect(res.extrasError?.startsWith("onFailure: ")).toBe(true);
    expect(transact.mock.calls[0]![0] as any[]).toHaveLength(1);
  });

  test("rejected transact (InstantAPIError 400) with extras → retries with failed only, extrasError 'onFailure rejected: …'", async () => {
    const transact = mock(async (_: unknown) => ({}));
    transact.mockImplementationOnce(async () => {
      throw rejection();
    });
    const { db } = fakeDb([open], transact);
    const res = await markFailed(db, sortear, "c1", "m", async () => [{ x: 1 }] as any[]);
    expect(res).toEqual({ written: true, extrasError: "onFailure rejected: not unique" });
    expect(transact).toHaveBeenCalledTimes(2);
    expect(transact.mock.calls[0]![0] as any[]).toHaveLength(2);
    const second = transact.mock.calls[1]![0] as any;
    expect(Array.isArray(second) ? second : [second]).toHaveLength(1);
  });

  test("network error on transact propagates and is not retried", async () => {
    const transact = mock(async (_: unknown) => {
      throw new TypeError("fetch failed");
    });
    const { db } = fakeDb([open], transact);
    await expect(markFailed(db, sortear, "c1", "m", async () => [{ x: 1 }] as any[])).rejects.toThrow("fetch failed");
    expect(transact).toHaveBeenCalledTimes(1);
  });

  test("429 is not a rejection", () => {
    const e = (status: number) => ({ name: "InstantAPIError", status });
    expect(isInstantRejection(e(429))).toBe(false);
    expect(isInstantRejection(e(408))).toBe(false);
    expect(isInstantRejection(e(400))).toBe(true);
    expect(isInstantRejection(e(500))).toBe(false);
    expect(isInstantRejection(new TypeError("x"))).toBe(false);
  });
});
