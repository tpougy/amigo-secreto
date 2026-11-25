import type { Jsonify } from "../types";
import type { EngineStep, RetryPolicy } from "./engine";

export interface Step {
  /**
   * Runs `fn(...args)` as a durable step. The result is stored as JSON and typed as such
   * (a `Date` comes back as a `string`).
   */
  run<F extends (...args: any[]) => any>(
    name: string | { name: string; retryPolicy?: RetryPolicy },
    fn: F,
    ...args: Parameters<F>
  ): Promise<Jsonify<Awaited<ReturnType<F>>>>;
}

/** Marker stored as the step output when `fail()` is called inside a step. */
type FailMarker = { __icFail: string };

function isFailMarker(value: unknown): value is FailMarker {
  return typeof value === "object" && value !== null && typeof (value as FailMarker).__icFail === "string";
}

function isCommandFailure(error: unknown): error is Error {
  return error instanceof Error && error.name === "CommandFailure";
}

// TODO(Task 11): throw the real `CommandFailure` class.
function commandFailure(message: string): Error {
  const e = new Error(message);
  e.name = "CommandFailure";
  return e;
}

/**
 * Typed `step.run` over the engine. `defaultPolicy` sits under each call's own policy.
 * A `CommandFailure` thrown inside a step completes the step with a marker and is re-thrown
 * outside it, so `fail()` inside a step is never retried (nor re-run on replay).
 */
export function createStep(engineStep: EngineStep, defaultPolicy?: RetryPolicy): Step {
  return {
    async run(name, fn, ...args) {
      const config = typeof name === "string" ? { name } : name;
      const retryPolicy = defaultPolicy || config.retryPolicy ? { ...defaultPolicy, ...config.retryPolicy } : undefined;
      const out = await engineStep.run(
        { name: config.name, ...(retryPolicy ? { retryPolicy } : {}) },
        async () => {
          try {
            return await fn(...args);
          } catch (error) {
            if (isCommandFailure(error)) return { __icFail: error.message } satisfies FailMarker;
            throw error;
          }
        },
      );
      if (isFailMarker(out)) throw commandFailure(out.__icFail);
      return out;
    },
  };
}
