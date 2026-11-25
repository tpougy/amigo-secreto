import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { i } from "@instantdb/core";
import { esperarAte, owTemporario } from "../../testes/helpers";
import { defineCommand } from "../command";
import { CommandDefinitionError } from "../errors";
import type { RunnerEvent } from "./execution";
import { defineHandler } from "./handler";
import { createRunner, resolveWebhookTrigger, type Runner } from "./runner";
import { defineSchedule } from "./schedule";

setDefaultTimeout(30_000);

const alpha = defineCommand({ name: "alpha", entity: "alphas", fields: { n: i.number() }, allow: { create: "true", view: "true" } });
const beta = defineCommand({ name: "beta", entity: "betas", fields: {}, allow: { create: "true", view: "true" } });
const alphaTwin = defineCommand({ name: "alpha2", entity: "alphas", fields: {}, allow: { create: "true", view: "true" } });
const alphaNamesake = defineCommand({ name: "alpha", entity: "alphas_b", fields: {}, allow: { create: "true", view: "true" } });

const hAlpha = defineHandler(alpha, async () => {});
const hBeta = defineHandler(beta, async () => {});

let cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.reverse()) await c();
  cleanups = [];
});

function tempOw(name: string) {
  const tmp = owTemporario(name);
  cleanups.push(() => tmp.limpar());
  return tmp.ow;
}

type Hook = { id: string; sink: { url: string }; namespaces: string[]; actions: string[]; status: string };

/** Fake admin db: webhooks (validate, fetch, manager) and `query` for the sweep. */
function fakeDb(opts: { hooks?: Hook[]; queryFails?: boolean } = {}) {
  const calls = { list: 0, create: [] as unknown[], update: [] as unknown[], enable: [] as string[], query: 0, validate: 0 };
  const hooks = opts.hooks ?? [];
  const db = {
    query: async (q: Record<string, unknown>) => {
      calls.query++;
      if (opts.queryFails) throw new Error("query exploded");
      return Object.fromEntries(Object.keys(q).map((k) => [k, []]));
    },
    webhooks: {
      validateRequest: async () => {
        calls.validate++;
        return { payloadUrl: "u", token: "t" };
      },
      fetchPayloads: async () => ({ data: [], idempotencyKey: "k" }),
      manager: {
        list: async () => {
          calls.list++;
          return hooks;
        },
        create: async (c: unknown) => {
          calls.create.push(c);
          return { id: "w1" };
        },
        update: async (id: string, u: unknown) => {
          calls.update.push([id, u]);
        },
        enable: async (id: string) => {
          calls.enable.push(id);
        },
      },
    },
  } as any;
  return { db, calls };
}

function track(runner: Runner) {
  cleanups.push(() => runner.stop());
  return runner;
}

describe("createRunner checks", () => {
  const base = () => ({ ow: tempOw("checks"), db: fakeDb().db, trigger: { type: "subscription" } as const });

  test("rejects two handlers for the same command", () => {
    const handlers = [hAlpha, hAlpha] as any;
    expect(() => createRunner({ ...base(), handlers })).toThrow(CommandDefinitionError);
  });

  test("rejects commands sharing an entity", () => {
    const handlers = [hAlpha, defineHandler(alphaTwin, async () => {})] as any;
    expect(() => createRunner({ ...base(), handlers })).toThrow(/entity "alphas"/);
  });

  test("rejects commands sharing a name", () => {
    const handlers = [hAlpha, defineHandler(alphaNamesake, async () => {})] as any;
    expect(() => createRunner({ ...base(), handlers })).toThrow(/name "alpha"/);
  });

  test("rejects a schedule named like a command", () => {
    const schedules = [defineSchedule({ name: "beta", cron: "0 0 * * *", run: async () => null })] as any;
    expect(() => createRunner({ ...base(), handlers: [hAlpha, hBeta], schedules })).toThrow(CommandDefinitionError);
  });
});

describe("webhook mode", () => {
  test("start ensures the webhook, starts the server and sweeps once", async () => {
    const { db, calls } = fakeDb();
    const events: RunnerEvent[] = [];
    const runner = track(
      createRunner({
        ow: tempOw("wh"),
        db,
        handlers: [hAlpha, hBeta],
        trigger: { type: "webhook", publicUrl: "https://w.example/ic/hook", port: 0 },
        onEvent: (e) => events.push(e),
      }),
    );
    await runner.start();
    expect(calls.list).toBe(1);
    expect(calls.create).toEqual([{ url: "https://w.example/ic/hook", namespaces: ["alphas", "betas"], actions: ["create"] }]);
    expect(calls.query).toBe(2); // one sweep: one query per entity
    expect(events.map((e) => e.type)).toEqual(["webhook.ensured", "sweep"]);

    const port = runner.port!;
    expect(port).toBeGreaterThan(0);
    expect((await fetch(`http://localhost:${port}/health`)).status).toBe(200);
    expect((await fetch(`http://localhost:${port}/ic/hook`, { method: "POST", body: "{}" })).status).toBe(200);
    expect(calls.validate).toBe(1);
    expect((await fetch(`http://localhost:${port}/other`)).status).toBe(404);

    await runner.stop();
    await expect(fetch(`http://localhost:${port}/health`)).rejects.toThrow();
  });

  test("external: no server, webhookHandler works", async () => {
    const { db, calls } = fakeDb({
      hooks: [{ id: "w9", sink: { url: "https://w.example/ic/hook" }, namespaces: ["alphas"], actions: ["create"], status: "disabled" }],
    });
    const runner = track(
      createRunner({
        ow: tempOw("ext"),
        db,
        handlers: [hAlpha],
        trigger: { type: "webhook", publicUrl: "https://w.example/ic/hook", server: "external" },
      }),
    );
    await runner.start();
    expect(runner.port).toBeUndefined();
    expect(calls.enable).toEqual(["w9"]);
    const res = await runner.webhookHandler(new Request("http://x/ic/hook", { method: "POST", body: "{}" }));
    expect(res.status).toBe(200);
    expect(calls.validate).toBe(1);
  });

  test("defaults: port from PORT, path from publicUrl, /health, 5 min sweep, 64 KB body", () => {
    const old = process.env.PORT;
    try {
      process.env.PORT = "4321";
      expect(resolveWebhookTrigger({ type: "webhook", publicUrl: "https://w.example/ic/hook" })).toEqual({
        publicUrl: "https://w.example/ic/hook",
        server: "builtin",
        port: 4321,
        path: "/ic/hook",
        healthPath: "/health",
        sweepEveryMs: 300_000,
        maxBodyBytes: 65_536,
      });
      delete process.env.PORT;
      expect(resolveWebhookTrigger({ type: "webhook", publicUrl: "https://w.example/x" }).port).toBe(3000);
    } finally {
      if (old === undefined) delete process.env.PORT;
      else process.env.PORT = old;
    }
  });

  test("the builtin server listens on PORT by default", async () => {
    const old = process.env.PORT;
    const free = Bun.serve({ port: 0, fetch: () => new Response() });
    const port = free.port as number;
    await free.stop(true);
    process.env.PORT = String(port);
    try {
      const runner = track(
        createRunner({
          ow: tempOw("port"),
          db: fakeDb().db,
          handlers: [hAlpha],
          trigger: { type: "webhook", publicUrl: "https://w.example/ic/hook" },
        }),
      );
      await runner.start();
      expect(runner.port).toBe(port);
      expect((await fetch(`http://localhost:${port}/health`)).status).toBe(200);
    } finally {
      if (old === undefined) delete process.env.PORT;
      else process.env.PORT = old;
    }
  });

  test("a failing sweep is reported as run.failed, also on the periodic timer", async () => {
    const events: RunnerEvent[] = [];
    const runner = track(
      createRunner({
        ow: tempOw("sweepfail"),
        db: fakeDb({ queryFails: true }).db,
        handlers: [hAlpha],
        trigger: { type: "webhook", publicUrl: "https://w.example/ic/hook", server: "external", sweepEveryMs: 20 },
        onEvent: (e) => events.push(e),
      }),
    );
    await runner.start();
    await esperarAte(async () => events.filter((e) => e.type === "run.failed").length >= 2, 5000);
    expect(events.find((e) => e.type === "run.failed")!.error).toBe("query exploded");
  });

  test("an onEvent that throws never breaks the runner", async () => {
    const runner = track(
      createRunner({
        ow: tempOw("throws"),
        db: fakeDb().db,
        handlers: [hAlpha],
        trigger: { type: "webhook", publicUrl: "https://w.example/ic/hook", server: "external" },
        onEvent: () => {
          throw new Error("app bug");
        },
      }),
    );
    await runner.start();
    const res = await runner.webhookHandler(new Request("http://x/ic/hook", { method: "POST", body: "{}" }));
    expect(res.status).toBe(200);
  });

  test("a failing ensureWebhook rejects start and undoes what was started", async () => {
    const { db } = fakeDb();
    db.webhooks.manager.list = async () => {
      throw new Error("instant down");
    };
    const runner = track(
      createRunner({
        ow: tempOw("ensurefail"),
        db,
        handlers: [hAlpha],
        trigger: { type: "webhook", publicUrl: "https://w.example/ic/hook", port: 0 },
      }),
    );
    await expect(runner.start()).rejects.toThrow("instant down");
    expect(runner.port).toBeUndefined();
    await runner.stop();
  });

  test("start twice is a no-op", async () => {
    const { db, calls } = fakeDb();
    const runner = track(
      createRunner({
        ow: tempOw("twice"),
        db,
        handlers: [hAlpha],
        trigger: { type: "webhook", publicUrl: "https://w.example/ic/hook", port: 0 },
      }),
    );
    await Promise.all([runner.start(), runner.start()]);
    const port = runner.port;
    await runner.start();
    expect(calls.list).toBe(1);
    expect(calls.query).toBe(1);
    expect(runner.port).toBe(port);
  });
});

describe("schedules", () => {
  test("a failing schedule (bad cron) is reported and does not stop the start", async () => {
    const events: RunnerEvent[] = [];
    let ran = 0;
    const runner = track(
      createRunner({
        ow: tempOw("badcron"),
        db: fakeDb().db,
        handlers: [hAlpha],
        schedules: [
          defineSchedule({ name: "broken", cron: "not a cron", runOnStart: true, run: async () => null }),
          defineSchedule({
            name: "fine",
            cron: "0 0 1 1 *",
            runOnStart: true,
            run: async ({ step }) => step.run("count", () => ++ran),
          }),
        ],
        trigger: { type: "webhook", publicUrl: "https://w.example/ic/hook", server: "external" },
        onEvent: (e) => events.push(e),
      }),
    );
    await runner.start();
    const failed = events.find((e) => e.type === "run.failed" && e.command === "broken");
    expect(failed?.error).toBeTruthy();
    await esperarAte(async () => ran === 1, 10_000);
  });
});

describe("subscription mode", () => {
  test("webhookHandler answers 404", async () => {
    const runner = createRunner({
      ow: tempOw("sub404"),
      db: fakeDb().db,
      handlers: [hAlpha],
      trigger: { type: "subscription" },
    });
    expect((await runner.webhookHandler(new Request("http://x/ic/hook", { method: "POST" }))).status).toBe(404);
  });
});
