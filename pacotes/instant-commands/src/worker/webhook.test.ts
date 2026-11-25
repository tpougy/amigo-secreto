import { describe, expect, test } from "bun:test";
import type { Command } from "../command";
import type { Engine } from "./engine";
import type { RunnerEvent } from "./execution";
import { startServer } from "./server";
import { createWebhookHandler, ensureWebhook } from "./webhook";

const cmd = { name: "sortear", entity: "sortear_cmds" } as unknown as Command;

type Rec = { namespace: string; id: string; action: string };

function setup(opts: { records?: Rec[]; invalid?: boolean; fetchFails?: boolean; dispatchFails?: boolean; max?: number } = {}) {
  const dispatched: [string, string][] = [];
  const events: RunnerEvent[] = [];
  let validated = 0;
  const db = {
    webhooks: {
      validateRequest: async () => {
        validated++;
        if (opts.invalid) throw new Error("bad signature");
        return { payloadUrl: "u", token: "t" };
      },
      fetchPayloads: async () => {
        if (opts.fetchFails) throw new Error("fetch failed");
        return { data: opts.records ?? [], idempotencyKey: "k" };
      },
    },
  } as any;
  const engine = {
    dispatch: async (n: string, id: string) => {
      if (opts.dispatchFails) throw new Error("boom");
      dispatched.push([n, id]);
    },
  } as unknown as Engine;
  const handler = createWebhookHandler({ db, engine, commands: [cmd], maxBodyBytes: opts.max ?? 1000, emit: (e) => events.push(e) });
  return { handler, dispatched, events, validated: () => validated };
}

const post = (body = "{}", headers: Record<string, string> = {}) =>
  new Request("http://x/ic/hook", { method: "POST", body, headers });
const rec = (namespace: string, action: string, id = "c1"): Rec => ({ namespace, id, action });

describe("webhook handler", () => {
  test("invalid signature → 401, no dispatch", async () => {
    const s = setup({ invalid: true, records: [rec("sortear_cmds", "create")] });
    expect((await s.handler(post())).status).toBe(401);
    expect(s.dispatched).toEqual([]);
    expect(s.events.map((e) => e.type)).toEqual(["webhook.rejected"]);
  });

  test("create of a command entity → dispatch + 200", async () => {
    const s = setup({ records: [rec("sortear_cmds", "create", "a"), rec("sortear_cmds", "create", "b")] });
    expect((await s.handler(post())).status).toBe(200);
    expect(s.dispatched).toEqual([["sortear", "a"], ["sortear", "b"]]);
    expect(s.events).toEqual([{ type: "webhook.received", count: 2 }]);
  });

  test("update/delete or unknown namespace → 200 without dispatch", async () => {
    const s = setup({ records: [rec("sortear_cmds", "update"), rec("sortear_cmds", "delete"), rec("outros", "create")] });
    expect((await s.handler(post())).status).toBe(200);
    expect(s.dispatched).toEqual([]);
  });

  test("dispatch error → 503, never 410", async () => {
    const s = setup({ dispatchFails: true, records: [rec("sortear_cmds", "create")] });
    expect((await s.handler(post())).status).toBe(503);
  });

  test("fetchPayloads failure → 503", async () => {
    const s = setup({ fetchFails: true });
    expect((await s.handler(post())).status).toBe(503);
    expect(s.dispatched).toEqual([]);
  });

  test("body over maxBodyBytes → 413 before validation", async () => {
    const s = setup({ max: 10 });
    const res = await s.handler(post("x".repeat(50), { "content-length": "50" }));
    expect(res.status).toBe(413);
    expect(s.validated()).toBe(0);
  });

  test("chunked body over maxBodyBytes → 413", async () => {
    const s = setup({ max: 10 });
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("x".repeat(8)));
        c.enqueue(new TextEncoder().encode("x".repeat(8)));
        c.close();
      },
    });
    const req = new Request("http://x/ic/hook", { method: "POST", body: stream, duplex: "half" } as any);
    expect(req.headers.get("content-length")).toBeNull();
    expect((await s.handler(req)).status).toBe(413);
    expect(s.validated()).toBe(0);
  });
});

function fakeManager(initial: any[] = []) {
  const calls: [string, ...unknown[]][] = [];
  const list = [...initial];
  const manager = {
    list: async () => list,
    create: async (a: any) => (calls.push(["create", a]), { id: "new" }),
    update: async (id: string, a: any) => void calls.push(["update", id, a]),
    enable: async (id: string) => void calls.push(["enable", id]),
    delete: async () => {},
  };
  return { db: { webhooks: { manager } } as any, calls };
}
const URL_ = "https://h.example/ic/hook";
const info = (over: any = {}) => ({
  id: "w1",
  sink: { url: URL_ },
  namespaces: ["a"],
  actions: ["create"],
  status: "active",
  ...over,
});

describe("ensureWebhook", () => {
  test("creates when missing", async () => {
    const { db, calls } = fakeManager([info({ sink: { url: "https://other/x" } })]);
    const events: RunnerEvent[] = [];
    const id = await ensureWebhook(db, URL_, ["a", "b"], (e) => events.push(e));
    expect(id).toBe("new");
    expect(calls).toEqual([["create", { url: URL_, namespaces: ["a", "b"], actions: ["create"] }]]);
    expect(events.map((e) => e.type)).toEqual(["webhook.ensured"]);
  });

  test("updates namespaces when a command is added", async () => {
    const { db, calls } = fakeManager([info()]);
    expect(await ensureWebhook(db, URL_, ["a", "b"], () => {})).toBe("w1");
    expect(calls).toEqual([["update", "w1", { namespaces: ["a", "b"], actions: ["create"] }]]);
  });

  test("re-enables a disabled webhook", async () => {
    const { db, calls } = fakeManager([info({ status: "disabled" })]);
    await ensureWebhook(db, URL_, ["a"], () => {});
    expect(calls).toEqual([["enable", "w1"]]);
  });

  test("is a no-op when everything matches", async () => {
    const { db, calls } = fakeManager([info({ namespaces: ["b", "a"] })]);
    const events: RunnerEvent[] = [];
    expect(await ensureWebhook(db, URL_, ["a", "b"], (e) => events.push(e))).toBe("w1");
    expect(calls).toEqual([]);
    expect(events.length).toBe(1);
  });
});

describe("server", () => {
  test("GET /health → ok, unknown path → 404, POST route reaches the handler", async () => {
    const server = startServer({
      port: 0,
      path: "/ic/hook",
      healthPath: "/health",
      maxBodyBytes: 1000,
      handler: async () => new Response("handled"),
    });
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const h = await fetch(`${base}/health`);
      expect(h.status).toBe(200);
      expect(await h.text()).toBe("ok");
      expect((await fetch(`${base}/nada`)).status).toBe(404);
      expect(await (await fetch(`${base}/ic/hook`, { method: "POST", body: "{}" })).text()).toBe("handled");
    } finally {
      await server.stop();
    }
  });
});
