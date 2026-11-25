// The runner end to end, in subscription mode, against the test app and a temporary OpenWorkflow.
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { sendCommand, waitForCommand } from "../../src/client";
import { defineSchedule, initCommands, type Runner, type RunnerEvent } from "../../src/worker";
import { sortear } from "../app/commands";
import type { TestSchema } from "../app/schema";
import { adminIC, criarGrupo, esperarAte, limpar, limparRestos, novoPrefixo, novoUsuario, owTemporario } from "../helpers";

setDefaultTimeout(60_000);

const PREFIXO = novoPrefixo("runner");
const admin = adminIC();
const { defineHandler, createRunner } = initCommands<TestSchema>();

beforeAll(limparRestos);
afterAll(() => limpar(PREFIXO));

let cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.reverse()) await c();
  cleanups = [];
});

function tempOw(nome: string) {
  const tmp = owTemporario(nome);
  cleanups.push(() => tmp.limpar());
  return tmp.ow;
}

function track(runner: Runner) {
  cleanups.push(() => runner.stop());
  return runner;
}

async function enviar() {
  const org = await novoUsuario(PREFIXO);
  const grupo = await criarGrupo(PREFIXO, org);
  const cid = await sendCommand(org.db, sortear, { rodada: 2, chave: `${PREFIXO}-${crypto.randomUUID()}`, grupo });
  return { org, cid };
}

async function statusDe(cid: string) {
  const { sorteios } = await admin.query({ sorteios: { $: { where: { id: cid } } } });
  return sorteios[0]?.status;
}

describe("runner (subscription mode)", () => {
  test("end to end: sendCommand as organizer → handler runs → waitForCommand sees done with typed result", async () => {
    const events: RunnerEvent[] = [];
    const handler = defineHandler(sortear, async ({ db, command }) => {
      // Other leftovers in the shared app may be processed too: only ours is asserted.
      const { sorteios } = await db.query({ sorteios: { $: { where: { id: command.id } } } });
      return { pares: command.rodada * 10 + sorteios.length };
    });
    const runner = track(
      createRunner({
        ow: tempOw("runner-e2e"),
        db: admin,
        handlers: [handler],
        trigger: { type: "subscription" },
        onEvent: (e) => events.push(e),
      }),
    );
    await runner.start();
    const { org, cid } = await enviar();
    const state = await waitForCommand(org.db, sortear, cid, { timeoutMs: 30_000 });
    expect(state.status).toBe("done");
    const pares: number | undefined = state.result?.pares;
    expect(pares).toBe(21);
    expect(events.some((e) => e.type === "subscribed")).toBe(true);
    expect(events.some((e) => e.type === "run.done" && e.commandId === cid)).toBe(true);
  });

  test("stop waits for the in-flight run and stops sweeping", async () => {
    const started = new Set<string>();
    const finished = new Set<string>();
    const handler = defineHandler(sortear, async ({ command, step }) => {
      await step.run("slow", async (id: string) => {
        started.add(id);
        await new Promise((r) => setTimeout(r, 1000));
        finished.add(id);
        return null;
      }, command.id);
      return { pares: 1 };
    });
    const runner = track(
      createRunner({ ow: tempOw("runner-stop"), db: admin, handlers: [handler], trigger: { type: "subscription" } }),
    );
    await runner.start();
    const first = await enviar();
    await esperarAte(async () => started.has(first.cid), 20_000);
    await runner.stop();
    expect(finished.has(first.cid)).toBe(true);

    const second = await enviar();
    await new Promise((r) => setTimeout(r, 2000));
    expect(started.has(second.cid)).toBe(false);
    expect(await statusDe(second.cid)).toBe("pending");
  });

  test("schedule runOnStart runs once with db typed", async () => {
    const org = await novoUsuario(PREFIXO);
    const grupoId = await criarGrupo(PREFIXO, org);
    const titulos: string[] = [];
    const contar = defineSchedule<TestSchema>({
      name: "contar-grupos",
      cron: "0 0 1 1 *",
      timezone: "UTC",
      runOnStart: true,
      run: async ({ db, step }) => {
        const titulo = await step.run("ler", async () => {
          const { grupos } = await db.query({ grupos: { $: { where: { id: grupoId } } } });
          return grupos[0]?.titulo ?? null;
        });
        if (titulo) titulos.push(titulo);
      },
    });
    const runner = track(
      createRunner({
        ow: tempOw("runner-schedule"),
        db: admin,
        handlers: [defineHandler(sortear, async () => ({ pares: 0 }))],
        schedules: [contar],
        trigger: { type: "subscription" },
      }),
    );
    await runner.start();
    await esperarAte(async () => titulos.length === 1, 20_000);
    await new Promise((r) => setTimeout(r, 500));
    expect(titulos).toEqual([`${PREFIXO}-${grupoId}`]);
  });
});
