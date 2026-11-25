// Running one command: the check step, the handler, and the final status write.
import type { InstantAdminDatabase } from "@instantdb/admin";
import type { Command } from "../command";
import { validateInput } from "../fields";
import { validateResult } from "../result";
import { engineControlFlow, isFinalStepFailure, type Engine } from "./engine";
import { CommandFailure } from "./failure";
import { completeChunk, type CommandHandle, type Handler } from "./handler";
import { markDone, markFailed, markRunning } from "./status";
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

  engine.define(command.name, version, async ({ input: { commandId }, step: engineStep }) => {
    const ev = { ...base, commandId };

    // Each status write and its event live in an internal step: done once, not repeated on replay.
    const failStep = (message: string, error: string) =>
      engineStep.run({ name: "ic:fail" }, async () => {
        const written = await markFailed(db, command, commandId, message);
        emit(written ? { type: "run.failed", ...ev, error } : { type: "run.skipped", ...ev });
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
        await markFailed(db, command, commandId, defaultErrorMessage);
        emit({ type: "run.invalid_input", ...ev, fields });
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
        await failStep(e.message, e.message);
        return null;
      }
      // 6. Final step failure or any other exception: generic message; the real one only goes to the event.
      const original = isFinalStepFailure(e) ? e.originalError : e;
      await failStep(defaultErrorMessage, messageOf(original));
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
    if (finish.outcome === "invalid_result") await failStep(defaultErrorMessage, finish.error);
    return null;
  });
}
