// Internal engine: the narrow slice of OpenWorkflow the library needs (run with a key, durable
// steps with a retry policy, cron schedules). Kept behind this interface so another durable
// engine could replace it later; it is not a public abstraction.
import { defineWorkflowSpec, type OpenWorkflow, type RetryPolicy as OwRetryPolicy } from "openworkflow";

/** Retry policy of a step; intervals are OpenWorkflow `DurationString`s (`"10ms"`, `"1s"`, …). */
export type RetryPolicy = Partial<OwRetryPolicy>;

export interface EngineStep {
  run<T>(config: { name: string; retryPolicy?: RetryPolicy }, fn: () => Promise<T> | T): Promise<T>;
}

export interface Engine {
  define(
    name: string,
    version: string | undefined,
    fn: (ctx: { input: { commandId: string }; step: EngineStep }) => Promise<unknown>,
  ): void;
  dispatch(name: string, commandId: string): Promise<void>;
  defineSchedule(
    name: string,
    fn: (ctx: { step: EngineStep }) => Promise<unknown>,
    options: { cron: string; timezone?: string; runOnStart?: boolean },
  ): void;
  /**
   * Registers the schedules and starts the worker; a second call does nothing. A schedule that
   * fails to register (or to run on start) goes to `onScheduleError` and does not stop the others
   * nor the worker; without `onScheduleError` the error is thrown.
   */
  start(options: { concurrency: number; onScheduleError?: (name: string, error: unknown) => void }): Promise<void>;
  stop(): Promise<void>;
}

// OpenWorkflow 0.11 does not export its control-flow errors (worker/execution.js), so they are
// recognized by `name`.
const ALWAYS_CONTROL_FLOW = new Set(["StaleExecutionBranchError", "SleepSignalError", "StepLimitExceededError"]);

type StepErrorShape = {
  name: "StepError";
  stepFailedAttempts: number;
  retryPolicy: { maximumAttempts: number };
  originalError: unknown;
};

function isStepError(error: unknown): error is StepErrorShape {
  return error instanceof Error && error.name === "StepError" && typeof (error as any).stepFailedAttempts === "number";
}

/**
 * `true` when `error` must reach OpenWorkflow untouched: lease loss, sleep, the step limit, and
 * every failed step attempt that is not the last one (OpenWorkflow only reschedules the attempt
 * if its `StepError` reaches its own outer `catch`).
 */
export function engineControlFlow(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (ALWAYS_CONTROL_FLOW.has(error.name)) return true;
  if (isStepError(error)) {
    const max = error.retryPolicy?.maximumAttempts ?? 0;
    return max === 0 || error.stepFailedAttempts < max;
  }
  return false;
}

/** `true` for OpenWorkflow's step-limit error, live or as stored on a failed run. */
export function isStepLimitExceeded(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { name?: unknown; code?: unknown };
  return e.name === "StepLimitExceededError" || e.code === "STEP_LIMIT_EXCEEDED";
}

/** A step failure with no attempts left; `originalError` is what the step threw. */
export function isFinalStepFailure(error: unknown): error is { name: "StepError"; originalError: unknown } {
  return isStepError(error) && !engineControlFlow(error);
}

type Spec = ReturnType<typeof defineWorkflowSpec<{ commandId: string }, unknown>>;
type ScheduleSpec = ReturnType<typeof defineWorkflowSpec<null, unknown>>;

/** The engine on top of an `OpenWorkflow` client. */
export function openWorkflowEngine(ow: OpenWorkflow): Engine {
  const specs = new Map<string, Spec>();
  const schedules: { name: string; spec: ScheduleSpec; options: { cron: string; timezone?: string; runOnStart?: boolean } }[] = [];
  let worker: ReturnType<OpenWorkflow["newWorker"]> | undefined;

  return {
    define(name, version, fn) {
      const spec = defineWorkflowSpec<{ commandId: string }, unknown>(version === undefined ? { name } : { name, version });
      ow.defineWorkflow(spec, ({ input, step }) => fn({ input, step: step as EngineStep }));
      specs.set(name, spec);
    },

    /**
     * Ensures a live (or finished) run for `commandId`. The idempotency key holds any run for
     * 24 h, a failed one included; then ONE new run is opened with `<commandId>:retry:<failedRunId>`,
     * deterministic so repeated deliveries land on the same run. A run that failed on the step
     * limit is final: a new run would redo every step and hit the limit again.
     */
    async dispatch(name, commandId) {
      const spec = specs.get(name);
      if (!spec) throw new Error(`Unknown workflow "${name}"`);
      const input = { commandId };
      let h = await ow.runWorkflow(spec, input, { idempotencyKey: commandId });
      while (h.workflowRun.status === "failed" && !isStepLimitExceeded(h.workflowRun.error)) {
        h = await ow.runWorkflow(spec, input, { idempotencyKey: `${commandId}:retry:${h.workflowRun.id}` });
      }
    },

    defineSchedule(name, fn, options) {
      // `scheduleWorkflow` requires an unversioned spec.
      const spec = defineWorkflowSpec<null, unknown>({ name });
      ow.defineWorkflow(spec, ({ step }) => fn({ step: step as EngineStep }));
      schedules.push({ name, spec, options });
    },

    async start({ concurrency, onScheduleError }) {
      if (worker) return;
      for (const { name, spec, options } of schedules) {
        try {
          await ow.scheduleWorkflow(spec, null, {
            cron: options.cron,
            ...(options.timezone === undefined ? {} : { timezone: options.timezone }),
          });
          if (options.runOnStart) await ow.runWorkflow(spec, null);
        } catch (error) {
          if (!onScheduleError) throw error;
          onScheduleError(name, error);
        }
      }
      if (worker) return;
      worker = ow.newWorker({ concurrency });
      await worker.start();
    },

    /** Stops the worker; waits for in-flight runs. */
    async stop() {
      const w = worker;
      worker = undefined;
      await w?.stop();
    },
  };
}
