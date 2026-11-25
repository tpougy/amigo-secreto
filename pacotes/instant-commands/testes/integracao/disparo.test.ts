// Dispatch and sweep of pending commands against the test app.
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { sendCommand } from "../../src/client";
import { startPeriodicSweep, sweep } from "../../src/worker/dispatch";
import { openWorkflowEngine, type Engine } from "../../src/worker/engine";
import { registerHandler, type RunnerEvent } from "../../src/worker/execution";
import { defineHandler } from "../../src/worker/handler";
import { markDone, markFailed, markRunning } from "../../src/worker/status";
import { sortear } from "../app/commands";
import { adminIC, criarGrupo, esperarAte, limpar, limparRestos, novoPrefixo, novoUsuario, owTemporario } from "../helpers";

setDefaultTimeout(30_000);

const PREFIXO = novoPrefixo("disparo");
const admin = adminIC();

beforeAll(limparRestos);
afterAll(() => limpar(PREFIXO));

let cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.reverse()) await c();
  cleanups = [];
});

async function novoCommand(): Promise<string> {
  const org = await novoUsuario(PREFIXO);
  const grupoId = await criarGrupo(PREFIXO, org);
  return sendCommand(org.db, sortear, { rodada: 1, chave: `${PREFIXO}-${crypto.randomUUID()}`, grupo: grupoId });
}

describe("sweep", () => {
  test("dispatches the prefix's pending and running ids, not its done/failed ones", async () => {
    const pending = await novoCommand();
    const running = await novoCommand();
    const done = await novoCommand();
    const failed = await novoCommand();
    await markRunning(admin, sortear, running);
    await markDone(admin, sortear, done, { pares: 1 });
    await markFailed(admin, sortear, failed, "boom");

    const dispatched: string[] = [];
    const engine = { dispatch: async (_n: string, id: string) => void dispatched.push(id) } as unknown as Engine;
    const events: RunnerEvent[] = [];
    const count = await sweep(admin, engine, [sortear], (e) => events.push(e));

    expect(dispatched).toContain(pending);
    expect(dispatched).toContain(running);
    expect(dispatched).not.toContain(done);
    expect(dispatched).not.toContain(failed);
    expect(count).toBe(dispatched.length);
    expect(events).toEqual([{ type: "sweep", count }]);
  });

  test("a failing dispatch does not stop the others and emits run.failed with only the command name and id", async () => {
    const a = await novoCommand();
    const b = await novoCommand();
    const dispatched: string[] = [];
    const engine = {
      dispatch: async (_n: string, id: string) => {
        if (id === a) throw new Error("secret detail");
        dispatched.push(id);
      },
    } as unknown as Engine;
    const events: RunnerEvent[] = [];
    await sweep(admin, engine, [sortear], (e) => events.push(e));
    expect(dispatched).toContain(b);
    const failure = events.find((e) => e.type === "run.failed");
    expect(failure).toEqual({ type: "run.failed", command: "sortear", commandId: a, error: "secret detail" });
  });

  test("the same command notified 3 times (sweep x3) runs the handler once", async () => {
    const cid = await novoCommand();
    const tmp = owTemporario("disparo");
    const engine = openWorkflowEngine(tmp.ow);
    cleanups.push(async () => {
      await engine.stop();
      await tmp.limpar();
    });
    let calls = 0;
    registerHandler(
      engine,
      admin,
      defineHandler(sortear, async ({ command }) => {
        if (command.id === cid) calls++;
        return { pares: 1 };
      }),
      () => {},
    );
    await engine.start({ concurrency: 2 });
    for (let n = 0; n < 3; n++) await sweep(admin, engine, [sortear], () => {});
    await esperarAte(async () => {
      const { sorteios } = await admin.query({ sorteios: { $: { where: { id: cid } } } });
      return sorteios[0]?.status === "done";
    }, 20_000);
    await sweep(admin, engine, [sortear], () => {});
    const { sorteios } = await admin.query({ sorteios: { $: { where: { id: cid } } } });
    expect(sorteios[0]?.attempts).toBe(1);
    expect(calls).toBe(1);
  });
});

describe("startPeriodicSweep", () => {
  test("does not overlap while a sweep is still running", async () => {
    let running = 0;
    let maxRunning = 0;
    let started = 0;
    const handle = startPeriodicSweep(async () => {
      started++;
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 80));
      running--;
      return 0;
    }, 10);
    await new Promise((r) => setTimeout(r, 300));
    handle.stop();
    const after = started;
    await new Promise((r) => setTimeout(r, 100));
    expect(maxRunning).toBe(1);
    expect(started).toBeGreaterThanOrEqual(2);
    expect(started).toBe(after);
  });
});
