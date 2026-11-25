import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { Database } from "bun:sqlite";
import { esperarAte, owTemporario } from "../../testes/helpers";
import { engineControlFlow, isFinalStepFailure, openWorkflowEngine, type Engine } from "./engine";
import { createStep } from "./step";

setDefaultTimeout(30_000);

type Run = { id: string; status: string; idempotency_key: string | null };

let cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.reverse()) await c();
  cleanups = [];
});

/** A fresh engine on a temporary SQLite file, stopped and deleted after the test. */
function setup(nome: string) {
  const tmp = owTemporario(nome);
  const engine = openWorkflowEngine(tmp.ow);
  cleanups.push(async () => {
    await engine.stop();
    await tmp.limpar();
  });
  const runs = (sql: string, ...params: string[]): Run[] => {
    const db = new Database(tmp.arquivo, { readonly: true });
    try {
      return db.query(`select id, status, idempotency_key from workflow_runs ${sql}`).all(...params) as Run[];
    } finally {
      db.close();
    }
  };
  const runsOf = (key: string) => runs("where idempotency_key = ?", key);
  const finished = (r: Run) => r.status === "completed" || r.status === "succeeded" || r.status === "failed";
  async function waitFinished(key: string): Promise<Run> {
    await esperarAte(async () => runsOf(key).some(finished), 10_000);
    return runsOf(key).find(finished)!;
  }
  return { engine, runs, runsOf, waitFinished };
}

function commandFailure(message: string): Error {
  const e = new Error(message);
  e.name = "CommandFailure";
  return e;
}

async function startEngine(engine: Engine) {
  await engine.start({ concurrency: 1 });
}

test("a step that fails once then succeeds completes (retries are not swallowed)", async () => {
  const { engine, waitFinished } = setup("retry");
  let calls = 0;
  engine.define("retry", undefined, async ({ step }) => {
    const s = createStep(step);
    return s.run({ name: "flaky", retryPolicy: { maximumAttempts: 3, initialInterval: "10ms" } }, () => {
      calls++;
      if (calls === 1) throw new Error("transient");
      return "ok";
    });
  });
  await startEngine(engine);
  await engine.dispatch("retry", "c1");
  const run = await waitFinished("c1");
  expect(run.status).not.toBe("failed");
  expect(calls).toBe(2);
});

test("engineControlFlow: StepError before the last attempt → true; at the last → false; Stale/Sleep → true", () => {
  const stepError = (stepFailedAttempts: number, maximumAttempts: number) =>
    Object.assign(new Error("boom"), {
      name: "StepError",
      stepFailedAttempts,
      retryPolicy: { maximumAttempts },
      originalError: new Error("boom"),
    });
  const named = (name: string) => Object.assign(new Error(name), { name });

  expect(engineControlFlow(stepError(1, 3))).toBe(true);
  expect(engineControlFlow(stepError(2, 3))).toBe(true);
  expect(engineControlFlow(stepError(3, 3))).toBe(false);
  expect(engineControlFlow(stepError(50, 0))).toBe(true);
  expect(engineControlFlow(named("StaleExecutionBranchError"))).toBe(true);
  expect(engineControlFlow(named("SleepSignalError"))).toBe(true);
  expect(engineControlFlow(named("StepLimitExceededError"))).toBe(true);
  expect(engineControlFlow(new Error("other"))).toBe(false);
  expect(engineControlFlow("not an error")).toBe(false);

  expect(isFinalStepFailure(stepError(3, 3))).toBe(true);
  expect(isFinalStepFailure(stepError(1, 3))).toBe(false);
  expect(isFinalStepFailure(new Error("other"))).toBe(false);
});

test("fail inside a step: thrown once, step not retried", async () => {
  const { engine, waitFinished } = setup("fail");
  let calls = 0;
  let caught: unknown;
  engine.define("fail", undefined, async ({ step }) => {
    const s = createStep(step);
    try {
      await s.run("check", () => {
        calls++;
        throw commandFailure("group is gone");
      });
    } catch (e) {
      caught = e;
    }
    return null;
  });
  await startEngine(engine);
  await engine.dispatch("fail", "c1");
  const run = await waitFinished("c1");
  expect(run.status).not.toBe("failed");
  expect(calls).toBe(1);
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).name).toBe("CommandFailure");
  expect((caught as Error).message).toBe("group is gone");
});

test("defaultPolicy applies when the call has none", async () => {
  const { engine, waitFinished } = setup("default-policy");
  let calls = 0;
  engine.define("dp", undefined, async ({ step }) => {
    const s = createStep(step, { maximumAttempts: 2, initialInterval: "10ms" });
    return s.run("always-fails", () => {
      calls++;
      throw new Error("nope");
    });
  });
  await startEngine(engine);
  await engine.dispatch("dp", "c1");
  const run = await waitFinished("c1");
  expect(run.status).toBe("failed");
  expect(calls).toBe(2);
});

test("dispatch twice with the same id creates one run", async () => {
  const { engine, runsOf } = setup("idem");
  engine.define("idem", "1", async () => null);
  await engine.dispatch("idem", "same");
  await engine.dispatch("idem", "same");
  expect(runsOf("same")).toHaveLength(1);
});

test("dispatch to an unknown workflow throws", async () => {
  const { engine } = setup("unknown");
  await expect(engine.dispatch("nope", "c1")).rejects.toThrow(/nope/);
});

test("dispatch after a failed run chains a retry key", async () => {
  const { engine, runs, waitFinished } = setup("chain");
  let calls = 0;
  engine.define("chain", undefined, async () => {
    calls++;
    if (calls === 1) throw new Error("first run fails");
    return "ok";
  });
  await startEngine(engine);
  await engine.dispatch("chain", "c1");
  const first = await waitFinished("c1");
  expect(first.status).toBe("failed");

  await engine.dispatch("chain", "c1");
  const retryKey = `c1:retry:${first.id}`;
  const second = await waitFinished(retryKey);
  expect(second.status).not.toBe("failed");
  expect(runs("where idempotency_key like ?", "c1:retry:%")).toHaveLength(1);
});

test("step.run passes args and returns Date as ISO string", async () => {
  const { engine, waitFinished } = setup("args");
  let got: unknown;
  engine.define("args", undefined, async ({ input, step }) => {
    const s = createStep(step);
    const r = await s.run("build", (n: number, label: string) => ({ quando: new Date(0), n, label }), 7, input.commandId);
    got = r;
    return r;
  });
  await startEngine(engine);
  await engine.dispatch("args", "c1");
  await waitFinished("c1");
  expect(got).toEqual({ quando: new Date(0).toISOString(), n: 7, label: "c1" });
  expect(typeof (got as { quando: unknown }).quando).toBe("string");
});

test("schedule with runOnStart runs once at start", async () => {
  const { engine, runs } = setup("schedule");
  let calls = 0;
  engine.defineSchedule(
    "sweep",
    async ({ step }) => {
      await step.run({ name: "count" }, () => {
        calls++;
        return null;
      });
    },
    { cron: "0 0 1 1 *", timezone: "UTC", runOnStart: true },
  );
  await startEngine(engine);
  await esperarAte(async () => calls === 1, 10_000);
  await new Promise((r) => setTimeout(r, 300));
  expect(calls).toBe(1);
  expect(runs("where workflow_name = ?", "sweep")).toHaveLength(1);
});

test("stop waits for an in-flight run", async () => {
  const { engine } = setup("stop");
  let started = false;
  let finished = false;
  engine.define("slow", undefined, async ({ step }) => {
    await step.run({ name: "slow" }, async () => {
      started = true;
      await new Promise((r) => setTimeout(r, 500));
      finished = true;
      return null;
    });
  });
  await startEngine(engine);
  await engine.dispatch("slow", "c1");
  await esperarAte(async () => started, 10_000);
  await engine.stop();
  expect(finished).toBe(true);
});
