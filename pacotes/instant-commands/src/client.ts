import { id, tx } from "@instantdb/core";
import type { Command } from "./command";
import { CommandInputError } from "./errors";
import { validateInput } from "./fields";
import { validateResult } from "./result";
import type { CommandId, CommandState, InputOf } from "./types";

export type { CommandId, CommandState } from "./types";

/**
 * Structural database type: accepts `InstantCoreDatabase` and the admin client's `asUser(...)`.
 * Chunks must be built with the `tx` exported by `@instantdb/core`.
 */
export type ClientDb = {
  transact(chunks: unknown): Promise<unknown>;
  subscribeQuery(q: unknown, cb: (r: any) => void): (() => void) | { close(): void };
};

/** Validates `input`, then writes a `pending` command linked to the given ids. Returns its id. */
export async function sendCommand<C extends Command>(
  db: ClientDb,
  command: C,
  input: InputOf<C>,
): Promise<CommandId<C>> {
  const values = input as Record<string, unknown>;
  const problems = validateInput(command, values, "client");
  if (problems.length > 0) throw new CommandInputError(problems);

  const data: Record<string, unknown> = { status: "pending", attempts: 0, createdAt: Date.now() };
  for (const name of Object.keys(command.fields ?? {})) {
    if (values[name] !== undefined) data[name] = values[name];
  }
  const links: Record<string, string> = {};
  for (const link of Object.values(command.links ?? {})) {
    links[link.forward.label] = values[link.forward.label] as string;
  }

  const commandId = id();
  const chunk = (tx as any)[command.entity][commandId].update(data);
  await db.transact(Object.keys(links).length > 0 ? chunk.link(links) : chunk);
  return commandId as CommandId<C>;
}

function toState<C extends Command>(command: C, commandId: CommandId<C>, rec: any): CommandState<C> {
  if (rec == null) return null;
  let result: unknown = null;
  let resultIssues: { message: string }[] | null = null;
  if (rec.result != null) {
    const v = validateResult(command, rec.result);
    if (v.ok) result = v.value;
    else resultIssues = v.issues.map((x) => ({ message: x.message }));
  }
  return {
    id: commandId,
    status: rec.status,
    error: rec.error ?? null,
    result: result as any,
    resultIssues,
    attempts: rec.attempts,
    createdAt: rec.createdAt,
    finishedAt: rec.finishedAt ?? null,
  };
}

/**
 * Calls `callback` with the command's state on every change (`null` if it disappears).
 * Subscription errors are not delivered; use a timeout (see `waitForCommand`) if you need one.
 * Returns the unsubscribe function.
 */
export function subscribeCommand<C extends Command>(
  db: ClientDb,
  command: C,
  commandId: CommandId<C>,
  callback: (state: CommandState<C>) => void,
): () => void {
  const sub = db.subscribeQuery({ [command.entity]: { $: { where: { id: commandId } } } }, (r) => {
    // core: { data, error }; admin: { type: "ok", data } | { type: "error", error }
    if (r == null || r.error || r.type === "error" || !r.data) return;
    callback(toState(command, commandId, r.data[command.entity]?.[0]));
  });
  return () => (typeof sub === "function" ? sub() : sub.close());
}

/** Resolves when the command is `done` or `failed`; rejects on timeout (default 30 s) or if it disappears. */
export function waitForCommand<C extends Command>(
  db: ClientDb,
  command: C,
  commandId: CommandId<C>,
  options: { timeoutMs?: number } = {},
): Promise<NonNullable<CommandState<C>>> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  return new Promise((resolve, reject) => {
    let settled = false;
    let off: (() => void) | undefined;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      off?.();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error(`Timed out after ${timeoutMs} ms waiting for command ${commandId}`))),
      timeoutMs,
    );
    off = subscribeCommand(db, command, commandId, (state) => {
      if (state === null) finish(() => reject(new Error(`Command ${commandId} no longer exists`)));
      else if (state.status === "done" || state.status === "failed") finish(() => resolve(state));
    });
    // The callback may have settled synchronously, before `off` was assigned.
    if (settled) off();
  });
}
