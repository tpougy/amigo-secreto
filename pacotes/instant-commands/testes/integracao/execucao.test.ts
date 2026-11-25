// Running one command end to end (check → handler → finish) on a temporary OpenWorkflow and the test app.
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { i } from "@instantdb/core";
import { sendCommand } from "../../src/client";
import { defineCommand } from "../../src/index";
import { openWorkflowEngine } from "../../src/worker/engine";
import { registerHandler, type RunnerEvent } from "../../src/worker/execution";
import { defineHandler, fail, failCommand, type FailureContext, type FailureHook, type Handler } from "../../src/worker/handler";
import { markDone, markRunning } from "../../src/worker/status";
import { sortear } from "../app/commands";
import { adminIC, criarGrupo, esperarAte, limpar, limparRestos, novoPrefixo, novoUsuario, owTemporario } from "../helpers";

setDefaultTimeout(30_000);

const PREFIXO = novoPrefixo("execucao");
const admin = adminIC();
const DEFAULT_ERROR = "Could not complete the command";

beforeAll(limparRestos);
afterAll(() => limpar(PREFIXO));

let cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.reverse()) await c();
  cleanups = [];
});

const EVENT_KEYS = new Set(["type", "command", "commandId", "count", "error", "fields"]);
const failedEvents = (events: RunnerEvent[], cid: string) =>
  events.filter((e) => e.commandId === cid && e.type === "command.failed");

/** Fresh engine with `handler` registered and started; returns the collected events. */
async function rodar(nome: string, handler: Handler<any, any>) {
  const tmp = owTemporario(nome);
  const engine = openWorkflowEngine(tmp.ow);
  const events: RunnerEvent[] = [];
  registerHandler(engine, admin, handler, (e) => {
    for (const k of Object.keys(e)) expect(EVENT_KEYS.has(k)).toBe(true);
    events.push(e);
  });
  cleanups.push(async () => {
    await engine.stop();
    await tmp.limpar();
  });
  await engine.start({ concurrency: 1 });
  return { engine, events };
}

async function novoCommand(chave = `${PREFIXO}-${crypto.randomUUID()}`): Promise<{ cid: string; grupoId: string; chave: string }> {
  const org = await novoUsuario(PREFIXO);
  const grupoId = await criarGrupo(PREFIXO, org);
  const cid = await sendCommand(org.db, sortear, { rodada: 1, chave, grupo: grupoId });
  return { cid, grupoId, chave };
}

async function ler(cid: string) {
  const { sorteios } = await admin.query({ sorteios: { $: { where: { id: cid } } } });
  return sorteios[0];
}

async function esperarFim(cid: string) {
  await esperarAte(async () => {
    const s = (await ler(cid))?.status;
    return s === "done" || s === "failed";
  }, 15_000);
  return (await ler(cid))!;
}

async function esperarEvento(events: RunnerEvent[], cid: string, type: RunnerEvent["type"]) {
  await esperarAte(async () => events.some((e) => e.commandId === cid && e.type === type), 15_000);
  return events.find((e) => e.commandId === cid && e.type === type)!;
}

describe("command execution", () => {
  test("happy path: handler completes in its own transaction → done with result", async () => {
    let calls = 0;
    const h = defineHandler(sortear, async ({ db, command }) => {
      calls++;
      expect(command.rodada).toBe(1);
      expect(command.chave.startsWith(PREFIXO)).toBe(true);
      await db.transact(command.complete({ pares: command.rodada + 1 }));
    });
    const { engine, events } = await rodar("happy", h);
    const { cid } = await novoCommand();
    await engine.dispatch("sortear", cid);
    const r = await esperarFim(cid);
    expect(r.status).toBe("done");
    expect(r.result).toEqual({ pares: 2 });
    expect(r.attempts).toBe(1);
    expect(r.error).toBeNull();
    await esperarEvento(events, cid, "run.done");
    expect(events.filter((e) => e.commandId === cid).map((e) => e.type)).toEqual(["run.started", "run.done"]);
    expect(calls).toBe(1);
  });

  test("handler returns a value without complete → done with that result", async () => {
    const h = defineHandler(sortear, async () => ({ pares: 7 }));
    const { engine, events } = await rodar("retorno", h);
    const { cid } = await novoCommand();
    await engine.dispatch("sortear", cid);
    const r = await esperarFim(cid);
    expect(r.status).toBe("done");
    expect(r.result).toEqual({ pares: 7 });
    expect(typeof r.finishedAt).toBe("number");
    await esperarEvento(events, cid, "run.done");
  });

  test("fail('msg') → failed with error 'msg', no retry", async () => {
    let calls = 0;
    const h = defineHandler(
      sortear,
      async () => {
        calls++;
        fail("not enough participants");
      },
      { retryPolicy: { maximumAttempts: 3, initialInterval: "10ms" } },
    );
    const { engine, events } = await rodar("fail", h);
    const { cid } = await novoCommand();
    await engine.dispatch("sortear", cid);
    const r = await esperarFim(cid);
    expect(r.status).toBe("failed");
    expect(r.error).toBe("not enough participants");
    expect(typeof r.finishedAt).toBe("number");
    const ev = await esperarEvento(events, cid, "run.failed");
    expect(ev.command).toBe("sortear");
    await new Promise((res) => setTimeout(res, 300));
    expect(calls).toBe(1);
  });

  test("step that fails once then succeeds → done (retry not swallowed)", async () => {
    let attempts = 0;
    const h = defineHandler(
      sortear,
      async ({ step }) => {
        const n = await step.run("flaky", () => {
          attempts++;
          if (attempts === 1) throw new Error("transient");
          return 3;
        });
        return { pares: n };
      },
      { retryPolicy: { maximumAttempts: 3, initialInterval: "10ms" } },
    );
    const { engine } = await rodar("retry", h);
    const { cid } = await novoCommand();
    await engine.dispatch("sortear", cid);
    const r = await esperarFim(cid);
    expect(r.status).toBe("done");
    expect(r.result).toEqual({ pares: 3 });
    expect(attempts).toBe(2);
  });

  test("step that exhausts retries → failed with defaultErrorMessage; event carries the real error", async () => {
    let attempts = 0;
    const h = defineHandler(
      sortear,
      async ({ step }) => {
        await step.run("always", () => {
          attempts++;
          throw new Error("database exploded");
        });
      },
      { retryPolicy: { maximumAttempts: 2, initialInterval: "10ms" } },
    );
    const { engine, events } = await rodar("esgota", h);
    const { cid } = await novoCommand();
    await engine.dispatch("sortear", cid);
    const r = await esperarFim(cid);
    expect(r.status).toBe("failed");
    expect(r.error).toBe(DEFAULT_ERROR);
    const ev = await esperarEvento(events, cid, "run.failed");
    expect(ev.error).toBe("database exploded");
    expect(attempts).toBe(2);
  });

  test("fail('msg') inside a step → failed with 'msg', handler runs once", async () => {
    let calls = 0;
    let stepCalls = 0;
    const h = defineHandler(
      sortear,
      async ({ step }) => {
        calls++;
        await step.run("check", () => {
          stepCalls++;
          fail("group is closed");
        });
      },
      { retryPolicy: { maximumAttempts: 3, initialInterval: "10ms" } },
    );
    const { engine } = await rodar("failstep", h);
    const { cid } = await novoCommand();
    await engine.dispatch("sortear", cid);
    const r = await esperarFim(cid);
    expect(r.status).toBe("failed");
    expect(r.error).toBe("group is closed");
    await new Promise((res) => setTimeout(res, 300));
    expect(calls).toBe(1);
    expect(stepCalls).toBe(1);
  });

  test("command deleted mid-run → no ghost recreated", async () => {
    let liberar!: () => void;
    const sinal = new Promise<void>((res) => (liberar = res));
    let iniciou = false;
    const h = defineHandler(sortear, async () => {
      iniciou = true;
      await sinal;
      return { pares: 1 };
    });
    const { engine, events } = await rodar("apagado", h);
    const { cid, grupoId } = await novoCommand();
    await engine.dispatch("sortear", cid);
    await esperarAte(async () => iniciou, 15_000);
    expect((await ler(cid))?.status).toBe("running");
    await admin.transact(admin.tx.grupos[grupoId]!.delete());
    expect(await ler(cid)).toBeUndefined();
    liberar();
    await esperarEvento(events, cid, "run.skipped");
    expect(await ler(cid)).toBeUndefined();
    expect(events.some((e) => e.commandId === cid && e.type === "run.done")).toBe(false);
  });

  test("already done command → run.skipped, handler not called", async () => {
    let calls = 0;
    const h = defineHandler(sortear, async () => {
      calls++;
      return { pares: 9 };
    });
    const { engine, events } = await rodar("feito", h);
    const { cid } = await novoCommand();
    await markRunning(admin, sortear, cid);
    await markDone(admin, sortear, cid, { pares: 4 });
    await engine.dispatch("sortear", cid);
    await esperarEvento(events, cid, "run.skipped");
    const r = await ler(cid);
    expect(r?.status).toBe("done");
    expect(r?.result).toEqual({ pares: 4 });
    expect(r?.attempts).toBe(1);
    expect(calls).toBe(0);
  });

  test("stored input with wrong type → failed + run.invalid_input with field names", async () => {
    // Instant refuses wrong types and missing required attributes on write, so an "old format" record is
    // simulated the other way round: a newer card of the same entity requires a field the stored record lacks.
    const sortearNovo = defineCommand({
      ...sortear,
      name: "sortearNovo",
      fields: { ...sortear.fields, prioridade: i.number() },
    });
    let calls = 0;
    const h = defineHandler(sortearNovo, async () => {
      calls++;
      return { pares: 1 };
    });
    const { engine, events } = await rodar("entrada", h);
    const { cid } = await novoCommand();
    await engine.dispatch("sortearNovo", cid);
    const r = await esperarFim(cid);
    expect(r.status).toBe("failed");
    expect(r.error).toBe(DEFAULT_ERROR);
    const ev = await esperarEvento(events, cid, "run.invalid_input");
    expect(ev.command).toBe("sortearNovo");
    expect(ev.fields).toEqual(["prioridade"]);
    expect(calls).toBe(0);
  });

  test("invalid returned result → failed with defaultErrorMessage", async () => {
    const h = defineHandler(sortear, async () => ({ pares: "many" }) as any, {
      defaultErrorMessage: "Draw failed",
    });
    const { engine, events } = await rodar("resultado", h);
    const { cid } = await novoCommand();
    await engine.dispatch("sortear", cid);
    const r = await esperarFim(cid);
    expect(r.status).toBe("failed");
    expect(r.error).toBe("Draw failed");
    expect(r.result ?? null).toBeNull();
    const ev = await esperarEvento(events, cid, "run.failed");
    expect(typeof ev.error).toBe("string");
  });

  test("handler completes in its own transaction and then throws → stays done, run.failed emitted", async () => {
    const h = defineHandler(sortear, async ({ db, command }) => {
      await db.transact(command.complete({ pares: 5 }));
      throw new Error("after complete");
    });
    const { engine, events } = await rodar("depois", h);
    const { cid } = await novoCommand();
    await engine.dispatch("sortear", cid);
    const ev = await esperarEvento(events, cid, "run.failed");
    expect(ev.error).toBe("after complete");
    const r = await ler(cid);
    expect(r?.status).toBe("done");
    expect(r?.result).toEqual({ pares: 5 });
    expect(r?.error).toBeNull();
  });

  test("handler past the step limit → failed for good, no retry run re-executes its steps", async () => {
    let calls = 0;
    const reasons: string[] = [];
    const h = defineHandler(
      sortear,
      async ({ step }) => {
        calls++;
        for (let n = 0; n <= 1000; n++) await step.run(`s${n}`, () => n);
        return { pares: 1 };
      },
      {
        onFailure: (ctx) => {
          reasons.push(ctx.reason);
          return [];
        },
      },
    );
    const { engine, events } = await rodar("limite", h);
    const { cid } = await novoCommand();
    await engine.dispatch("sortear", cid);
    const r = await esperarFim(cid);
    expect(r.status).toBe("failed");
    expect(r.error).toBe(DEFAULT_ERROR);
    const ev = await esperarEvento(events, cid, "run.failed");
    expect(ev.error).toMatch(/step limit/);
    expect(failedEvents(events, cid)).toHaveLength(1);
    // A sweep would dispatch it again: no new run.
    await engine.dispatch("sortear", cid);
    await new Promise((res) => setTimeout(res, 500));
    expect(calls).toBe(1);
    expect(reasons).toEqual(["step_limit"]);
  }, 60_000);
});

/** Hook that records each ctx and renames the unique `chave` so it can be reused. */
function liberarChave(seen: FailureContext<any>[]): FailureHook<any> {
  return (ctx) => {
    seen.push(ctx);
    const { id, chave } = ctx.command as unknown as { id: string; chave: unknown };
    return [admin.tx.sorteios[id]!.update({ chave: `${chave}:erro:${id}` })];
  };
}

describe("onFailure", () => {
  test("step that exhausts retries → hook frees the chave; a new command with the same chave is accepted", async () => {
    const seen: FailureContext<typeof sortear>[] = [];
    const h = defineHandler(
      sortear,
      async ({ step }) => {
        await step.run({ name: "x", retryPolicy: { maximumAttempts: 2, initialInterval: "10ms" } }, () => {
          throw new Error("database exploded");
        });
      },
      { retryPolicy: { maximumAttempts: 2, initialInterval: "10ms" }, onFailure: liberarChave(seen) },
    );
    const { engine } = await rodar("of-esgota", h);
    const { cid, chave } = await novoCommand();
    await engine.dispatch("sortear", cid);
    const r = await esperarFim(cid);
    expect(r.status).toBe("failed");
    expect(r.error).toBe(DEFAULT_ERROR);
    expect(r.chave).toBe(`${chave}:erro:${cid}`);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.reason).toBe("error");
    expect(seen[0]!.error).toBe(DEFAULT_ERROR);
    expect(seen[0]!.command.id as string).toBe(cid);
    expect(seen[0]!.command.chave).toBe(chave);
    const again = await novoCommand(chave);
    expect(typeof again.cid).toBe("string");
  });

  test("fail('msg') → hook gets reason 'fail' and error 'msg'", async () => {
    const seen: FailureContext<typeof sortear>[] = [];
    const h = defineHandler(sortear, async () => fail("msg"), { onFailure: liberarChave(seen) });
    const { engine } = await rodar("of-fail", h);
    const { cid, chave } = await novoCommand();
    await engine.dispatch("sortear", cid);
    const r = await esperarFim(cid);
    expect(r.status).toBe("failed");
    expect(r.error).toBe("msg");
    expect(r.chave).toBe(`${chave}:erro:${cid}`);
    expect(seen.map((c) => [c.reason, c.error])).toEqual([["fail", "msg"]]);
  });

  test("invalid returned result → reason 'invalid_result'", async () => {
    const seen: FailureContext<typeof sortear>[] = [];
    const h = defineHandler(sortear, async () => ({ pares: "many" }) as any, { onFailure: liberarChave(seen) });
    const { engine } = await rodar("of-resultado", h);
    const { cid, chave } = await novoCommand();
    await engine.dispatch("sortear", cid);
    const r = await esperarFim(cid);
    expect(r.status).toBe("failed");
    expect(r.error).toBe(DEFAULT_ERROR);
    expect(r.chave).toBe(`${chave}:erro:${cid}`);
    expect(seen.map((c) => [c.reason, c.error])).toEqual([["invalid_result", DEFAULT_ERROR]]);
  });

  test("stored input invalid → reason 'invalid_input', command has only present fields", async () => {
    const sortearNovo = defineCommand({
      ...sortear,
      name: "sortearNovo",
      fields: { ...sortear.fields, prioridade: i.number() },
    });
    const seen: FailureContext<typeof sortearNovo>[] = [];
    const h = defineHandler(sortearNovo, async () => ({ pares: 1 }), { onFailure: liberarChave(seen) });
    const { engine } = await rodar("of-entrada", h);
    const { cid, chave } = await novoCommand();
    await engine.dispatch("sortearNovo", cid);
    const r = await esperarFim(cid);
    expect(r.status).toBe("failed");
    expect(r.chave).toBe(`${chave}:erro:${cid}`);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.reason).toBe("invalid_input");
    expect(seen[0]!.error).toBe(DEFAULT_ERROR);
    expect(seen[0]!.command.prioridade).toBeUndefined();
    expect(seen[0]!.command.chave).toBe(chave);
    expect(Object.keys(seen[0]!.command).sort()).toEqual(["chave", "id", "rodada"]);
  });

  test("handler fails itself with failCommand in its own transact → hook not called", async () => {
    const seen: FailureContext<typeof sortear>[] = [];
    const h = defineHandler(
      sortear,
      async ({ db, command }) => {
        await db.transact(failCommand(sortear, command.id, "own"));
      },
      { onFailure: liberarChave(seen) },
    );
    const { engine, events } = await rodar("of-proprio", h);
    const { cid, chave } = await novoCommand();
    await engine.dispatch("sortear", cid);
    const r = await esperarFim(cid);
    expect(r.status).toBe("failed");
    expect(r.error).toBe("own");
    expect(r.chave).toBe(chave);
    await esperarEvento(events, cid, "run.failed");
    expect(seen).toHaveLength(0);
  });

  test("hook that throws → failed with the original error, plus run.failed 'onFailure: …'", async () => {
    const h = defineHandler(sortear, async () => fail("original"), {
      onFailure: () => {
        throw new Error("hook bug");
      },
    });
    const { engine, events } = await rodar("of-lanca", h);
    const { cid, chave } = await novoCommand();
    await engine.dispatch("sortear", cid);
    const r = await esperarFim(cid);
    expect(r.status).toBe("failed");
    expect(r.error).toBe("original");
    expect(r.chave).toBe(chave);
    await esperarAte(async () => events.some((e) => e.commandId === cid && e.error?.startsWith("onFailure: ")), 15_000);
    const failed = events.filter((e) => e.commandId === cid && e.type === "run.failed");
    expect(failed.map((e) => e.error)).toEqual(["original", "onFailure: hook bug"]);
  });

  test("done command → hook not called", async () => {
    const seen: FailureContext<typeof sortear>[] = [];
    const h = defineHandler(sortear, async () => ({ pares: 1 }), { onFailure: liberarChave(seen) });
    const { engine, events } = await rodar("of-feito", h);
    const { cid } = await novoCommand();
    await engine.dispatch("sortear", cid);
    const r = await esperarFim(cid);
    expect(r.status).toBe("done");
    await esperarEvento(events, cid, "run.done");
    expect(seen).toHaveLength(0);
  });
});

describe("command.failed", () => {
  const evOf = (events: RunnerEvent[], cid: string) => events.filter((e) => e.commandId === cid).map((e) => e.type);

  test("fail('msg') → one command.failed with error 'msg'", async () => {
    const h = defineHandler(sortear, async () => fail("msg"));
    const { engine, events } = await rodar("cf-fail", h);
    const { cid } = await novoCommand();
    await engine.dispatch("sortear", cid);
    await esperarFim(cid);
    await esperarEvento(events, cid, "command.failed");
    const f = failedEvents(events, cid);
    expect(f).toHaveLength(1);
    expect(f[0]).toEqual({ type: "command.failed", command: "sortear", commandId: cid, error: "msg" });
  });

  test("step that exhausts retries → one command.failed with the default message", async () => {
    const h = defineHandler(
      sortear,
      async ({ step }) => {
        await step.run("always", () => {
          throw new Error("database exploded");
        });
      },
      { retryPolicy: { maximumAttempts: 2, initialInterval: "10ms" } },
    );
    const { engine, events } = await rodar("cf-esgota", h);
    const { cid } = await novoCommand();
    await engine.dispatch("sortear", cid);
    await esperarEvento(events, cid, "command.failed");
    const f = failedEvents(events, cid);
    expect(f).toHaveLength(1);
    expect(f[0]!.error).toBe(DEFAULT_ERROR);
  });

  test("invalid returned result → one command.failed", async () => {
    const h = defineHandler(sortear, async () => ({ pares: "many" }) as any, { defaultErrorMessage: "Draw failed" });
    const { engine, events } = await rodar("cf-resultado", h);
    const { cid } = await novoCommand();
    await engine.dispatch("sortear", cid);
    await esperarEvento(events, cid, "command.failed");
    const f = failedEvents(events, cid);
    expect(f).toHaveLength(1);
    expect(f[0]!.error).toBe("Draw failed");
  });

  test("stored input invalid → one command.failed", async () => {
    const sortearNovo = defineCommand({ ...sortear, name: "sortearNovo", fields: { ...sortear.fields, prioridade: i.number() } });
    const h = defineHandler(sortearNovo, async () => ({ pares: 1 }));
    const { engine, events } = await rodar("cf-entrada", h);
    const { cid } = await novoCommand();
    await engine.dispatch("sortearNovo", cid);
    await esperarEvento(events, cid, "command.failed");
    const f = failedEvents(events, cid);
    expect(f).toHaveLength(1);
    expect(f[0]!.error).toBe(DEFAULT_ERROR);
  });

  test("handler fails itself with failCommand and returns → one command.failed with that error", async () => {
    const h = defineHandler(sortear, async ({ db, command }) => {
      await db.transact(failCommand(sortear, command.id, "own"));
    });
    const { engine, events } = await rodar("cf-proprio", h);
    const { cid } = await novoCommand();
    await engine.dispatch("sortear", cid);
    await esperarEvento(events, cid, "command.failed");
    const f = failedEvents(events, cid);
    expect(f).toHaveLength(1);
    expect(f[0]!.error).toBe("own");
  });

  test("handler fails itself with failCommand and then throws → one command.failed with the stored error", async () => {
    const h = defineHandler(sortear, async ({ db, command }) => {
      await db.transact(failCommand(sortear, command.id, "own"));
      throw new Error("after failCommand");
    });
    const { engine, events } = await rodar("cf-proprio-lanca", h);
    const { cid } = await novoCommand();
    await engine.dispatch("sortear", cid);
    await esperarEvento(events, cid, "command.failed");
    await new Promise((res) => setTimeout(res, 300));
    const f = failedEvents(events, cid);
    expect(f).toHaveLength(1);
    expect(f[0]!.error).toBe("own");
  });

  test("onFailure that throws → one command.failed, after the run.failed and before the 'onFailure: ' run.failed", async () => {
    const h = defineHandler(sortear, async () => fail("original"), {
      onFailure: () => {
        throw new Error("hook bug");
      },
    });
    const { engine, events } = await rodar("cf-hook", h);
    const { cid } = await novoCommand();
    await engine.dispatch("sortear", cid);
    await esperarAte(async () => events.some((e) => e.commandId === cid && e.error?.startsWith("onFailure: ")), 15_000);
    const mine = events.filter((e) => e.commandId === cid);
    expect(failedEvents(events, cid)).toHaveLength(1);
    expect(failedEvents(events, cid)[0]!.error).toBe("original");
    const first = mine.findIndex((e) => e.type === "run.failed" && e.error === "original");
    const cf = mine.findIndex((e) => e.type === "command.failed");
    const extra = mine.findIndex((e) => e.type === "run.failed" && e.error === "onFailure: hook bug");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(cf).toBeGreaterThan(first);
    expect(extra).toBeGreaterThan(cf);
  });

  test("done command → no command.failed", async () => {
    const h = defineHandler(sortear, async () => ({ pares: 1 }));
    const { engine, events } = await rodar("cf-feito", h);
    const { cid } = await novoCommand();
    await engine.dispatch("sortear", cid);
    await esperarEvento(events, cid, "run.done");
    expect(failedEvents(events, cid)).toHaveLength(0);
    expect(evOf(events, cid)).not.toContain("command.failed");
  });

  test("command deleted mid-run → no command.failed", async () => {
    let liberar!: () => void;
    const sinal = new Promise<void>((res) => (liberar = res));
    let iniciou = false;
    const h = defineHandler(sortear, async () => {
      iniciou = true;
      await sinal;
      return { pares: 1 };
    });
    const { engine, events } = await rodar("cf-apagado", h);
    const { cid, grupoId } = await novoCommand();
    await engine.dispatch("sortear", cid);
    await esperarAte(async () => iniciou, 15_000);
    await admin.transact(admin.tx.grupos[grupoId]!.delete());
    liberar();
    await esperarEvento(events, cid, "run.skipped");
    expect(failedEvents(events, cid)).toHaveLength(0);
  });
});
