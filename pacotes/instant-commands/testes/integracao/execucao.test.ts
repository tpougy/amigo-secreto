// Running one command end to end (check → handler → finish) on a temporary OpenWorkflow and the test app.
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { i } from "@instantdb/core";
import { sendCommand } from "../../src/client";
import { defineCommand } from "../../src/index";
import { openWorkflowEngine } from "../../src/worker/engine";
import { registerHandler, type RunnerEvent } from "../../src/worker/execution";
import { defineHandler, fail, type Handler } from "../../src/worker/handler";
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

async function novoCommand(): Promise<{ cid: string; grupoId: string }> {
  const org = await novoUsuario(PREFIXO);
  const grupoId = await criarGrupo(PREFIXO, org);
  const cid = await sendCommand(org.db, sortear, {
    rodada: 1,
    chave: `${PREFIXO}-${crypto.randomUUID()}`,
    grupo: grupoId,
  });
  return { cid, grupoId };
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
});
