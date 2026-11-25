// Running one command: the check step, the handler, and the final status write.
import type { InstantAdminDatabase } from "@instantdb/admin";
import type { Command } from "../command";
import { validateInput } from "../fields";
import { validateResult } from "../result";
import { engineControlFlow, isFinalStepFailure, isStepLimitExceeded, type Engine, type EngineStep } from "./engine";
import { CommandFailure } from "./failure";
import { completeChunk, type CommandHandle, type FailureReason, type Handler } from "./handler";
import { markDone, markFailed, markRunning, type FailureExtras, type MarkFailedResult } from "./status";
import { createStep } from "./step";

/**
 * What the runner reports to `onEvent`. Never carries the command's field values: only its name and id,
 * counts, error messages and, on `run.invalid_input`, the names of the invalid fields.
 */
export type RunnerEvent = {
  type:
    | "webhook.ensured"
    | "webhook.received"
    | "webhook.rejected"
    | "sweep"
    | "subscribed"
    | "resubscribed"
    | "delivery"
    | "run.started"
    | "run.done"
    | "run.failed"
    | "run.skipped"
    | "run.invalid_input"
    | "subscription.error";
  command?: string;
  commandId?: string;
  count?: number;
  error?: string;
  /** Only on `run.invalid_input`. */
  fields?: string[];
};

export const DEFAULT_ERROR_MESSAGE = "Could not complete the command";

type Db = InstantAdminDatabase<any, any>;

type Check =
  | { proceed: false }
  | { proceed: true; invalid: string[] }
  | { proceed: true; invalid: null; record: Record<string, unknown> };

type Finish = { outcome: "done" | "skipped" } | { outcome: "invalid_result"; error: string };

async function readRecord(db: Db, command: Command, id: string): Promise<Record<string, any> | undefined> {
  const res = (await db.query({ [command.entity]: { $: { where: { id } } } } as any)) as unknown as Record<
    string,
    Record<string, any>[]
  >;
  return res[command.entity]?.[0];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCommandFailure(error: unknown): error is Error {
  return error instanceof CommandFailure || (error instanceof Error && error.name === "CommandFailure");
}

/** Registers the workflow that runs `handler` for one command id. */
export function registerHandler(
  engine: Engine,
  db: Db,
  handler: Handler<any, any>,
  emit: (e: RunnerEvent) => void,
): void {
  const command: Command = handler.command;
  const { version, retryPolicy } = handler.options;
  const defaultErrorMessage = handler.options.defaultErrorMessage ?? DEFAULT_ERROR_MESSAGE;
  const base = { command: command.name };
  const fieldNames = Object.keys(command.fields ?? {});

  /**
   * The `onFailure` hook, wrapped for `markFailed`: it gets the record re-read there, reduced to the
   * command's fields that are present. Called only through `markFailed`, so its chunks are written at
   * most once, together with `failed`.
   */
  function extrasFor(commandId: string, reason: FailureReason, message: string): FailureExtras | undefined {
    const hook = handler.options.onFailure;
    if (!hook) return undefined;
    return async (record) => {
      const fields: Record<string, unknown> = {};
      for (const name of fieldNames) {
        if (record[name] !== undefined && record[name] !== null) fields[name] = record[name];
      }
      return hook({ db, reason, error: message, command: { id: commandId, ...fields } } as any);
    };
  }

  /** `markFailed` with the hook; the caller emits its own event, then `reportExtras`. */
  async function writeFailed(commandId: string, reason: FailureReason, message: string): Promise<MarkFailedResult> {
    return markFailed(db, command, commandId, message, extrasFor(commandId, reason, message));
  }

  /** The extra `run.failed` when the hook's chunks could not be written. */
  function reportExtras(result: MarkFailedResult, commandId: string): void {
    if (result.extrasError !== undefined) emit({ type: "run.failed", ...base, commandId, error: result.extrasError });
  }

  engine.define(command.name, version, async ({ input: { commandId }, step: engineStep }) => {
    const ev = { ...base, commandId };
    try {
      return await runCommand(commandId, engineStep);
    } catch (e) {
      // The step limit is final: no step can be recorded anymore (so the write happens outside any
      // step), and the engine does not open a new run for it. The original error is ALWAYS rethrown:
      // the engine recognizes a step-limit run by its stored error, and any other error would make it
      // open a `:retry:` run that redoes every step (and the handler's side effects).
      if (isStepLimitExceeded(e)) {
        try {
          const result = await writeFailed(commandId, "step_limit", defaultErrorMessage);
          emit({ type: "run.failed", ...ev, error: messageOf(e) });
          reportExtras(result, commandId);
        } catch (writeError) {
          // The write with the hook failed (network, or a non-4xx error caused by its chunks): fall
          // back to `failed` alone.
          emit({ type: "run.failed", ...ev, error: messageOf(writeError) });
          try {
            await markFailed(db, command, commandId, defaultErrorMessage);
            emit({ type: "run.failed", ...ev, error: messageOf(e) });
          } catch (fallbackError) {
            emit({ type: "run.failed", ...ev, error: messageOf(fallbackError) });
          }
        }
      }
      throw e;
    }
  });

  async function runCommand(commandId: string, engineStep: EngineStep): Promise<null> {
    const ev = { ...base, commandId };

    // Each status write and its event live in an internal step: done once, not repeated on replay.
    const failStep = (reason: FailureReason, message: string, error: string) =>
      engineStep.run({ name: "ic:fail" }, async () => {
        // A deleted command is skipped; one already finished (e.g. by the handler itself) is not
        // overwritten, but the failure is still reported.
        if (!(await readRecord(db, command, commandId))) {
          emit({ type: "run.skipped", ...ev });
          return null;
        }
        const result = await writeFailed(commandId, reason, message);
        emit({ type: "run.failed", ...ev, error });
        reportExtras(result, commandId);
        return null;
      });

    // 1–2. Check: mark running, re-read, validate the stored input.
    const check: Check = await engineStep.run({ name: "ic:check" }, async () => {
      const state = await markRunning(db, command, commandId);
      const record = state === "absent" || state === "finished" ? undefined : await readRecord(db, command, commandId);
      if (!record) {
        emit({ type: "run.skipped", ...ev });
        return { proceed: false };
      }
      const problems = validateInput(command, record, "worker");
      if (problems.length > 0) {
        const fields = [...new Set(problems.map((p) => p.slice(0, p.indexOf(":"))))];
        const result = await writeFailed(commandId, "invalid_input", defaultErrorMessage);
        emit({ type: "run.invalid_input", ...ev, fields });
        reportExtras(result, commandId);
        return { proceed: true, invalid: fields };
      }
      const values: Record<string, unknown> = {};
      for (const name of Object.keys(command.fields ?? {})) values[name] = record[name] ?? undefined;
      emit({ type: "run.started", ...ev });
      return { proceed: true, invalid: null, record: values };
    });
    if (!check.proceed || check.invalid !== null) return null;

    // 3. The handler.
    const handle = {
      ...check.record,
      id: commandId,
      complete: (result?: unknown) => completeChunk(command, commandId, result as any),
    } as CommandHandle<any>;
    let returned: unknown;
    try {
      returned = await handler.fn({ db, command: handle, step: createStep(engineStep, retryPolicy) });
    } catch (e) {
      // 4. A non-final step failure (or lease loss, sleep...) must reach OpenWorkflow untouched,
      // otherwise the first failed attempt would end the command and no retry would happen.
      if (engineControlFlow(e)) throw e;
      // 5. fail(message): the message is the command's error.
      if (isCommandFailure(e)) {
        await failStep("fail", e.message, e.message);
        return null;
      }
      // 6. Final step failure or any other exception: generic message; the real one only goes to the event.
      const original = isFinalStepFailure(e) ? e.originalError : e;
      await failStep("error", defaultErrorMessage, messageOf(original));
      return null;
    }

    // 7. Finish: if the handler did not complete the command itself, store the returned value.
    const finish: Finish = await engineStep.run({ name: "ic:finish" }, async () => {
      const record = await readRecord(db, command, commandId);
      if (!record) {
        emit({ type: "run.skipped", ...ev });
        return { outcome: "skipped" };
      }
      if (record.status === "running") {
        const v = validateResult(command, returned);
        if (!v.ok) {
          return { outcome: "invalid_result", error: `Invalid command result: ${v.issues.map((i) => i.message).join("; ")}` };
        }
        if (!(await markDone(db, command, commandId, returned))) {
          emit({ type: "run.skipped", ...ev });
          return { outcome: "skipped" };
        }
      }
      // The handler may also have ended it itself (`command.complete` or `failCommand` in its own transaction).
      emit({ type: record.status === "failed" ? "run.failed" : "run.done", ...ev });
      return { outcome: "done" };
    });
    if (finish.outcome === "invalid_result") await failStep("invalid_result", defaultErrorMessage, finish.error);
    return null;
  }
}
