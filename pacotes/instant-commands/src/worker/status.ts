// Status writes of the worker. None of them recreates a deleted command nor overwrites a finished
// one: each queries the id first and writes only if the command still exists and is not terminal.
import { tx, type InstantAdminDatabase } from "@instantdb/admin";
import type { Command } from "../command";
import { CommandResultError } from "../errors";
import { validateResult } from "../result";

type Db = InstantAdminDatabase<any, any>;

type Row = { status: string; attempts?: number | null };

async function find(db: Db, command: Command, id: string): Promise<Row | undefined> {
  const res = (await db.query({ [command.entity]: { $: { where: { id } } } } as any)) as unknown as Record<string, Row[]>;
  return res[command.entity]?.[0];
}

function isOpen(row: Row | undefined): row is Row {
  return row !== undefined && (row.status === "pending" || row.status === "running");
}

function entityTx(command: Command, id: string): any {
  return (tx as any)[command.entity][id];
}

/** Chunk that ends the command as `failed`. */
export function failedChunk(command: Command, id: string, message: string) {
  return entityTx(command, id).update({ status: "failed", error: message, finishedAt: Date.now() });
}

/** Chunk that ends the command as `done`; validates `result` first and throws `CommandResultError`. */
export function doneChunk(command: Command, id: string, result: unknown) {
  const v = validateResult(command, result);
  if (!v.ok) throw new CommandResultError(v.issues);
  return entityTx(command, id).update({
    status: "done",
    result: v.value ?? null,
    error: null,
    finishedAt: Date.now(),
  });
}

/**
 * Marks the command `running` and counts the attempt. `"started"` from `pending`, `"resumed"`
 * from `running`, `"finished"` (no write) from `done`/`failed`, `"absent"` if it was deleted.
 */
export async function markRunning(
  db: Db,
  command: Command,
  id: string,
): Promise<"started" | "resumed" | "absent" | "finished"> {
  const row = await find(db, command, id);
  if (!row) return "absent";
  if (row.status === "done" || row.status === "failed") return "finished";
  await db.transact(entityTx(command, id).update({ status: "running", attempts: (row.attempts ?? 0) + 1 }));
  return row.status === "running" ? "resumed" : "started";
}

/** Marks the command `failed`; `false` (and no write) if it no longer exists or is already `done`/`failed`. */
export async function markFailed(db: Db, command: Command, id: string, message: string): Promise<boolean> {
  if (!isOpen(await find(db, command, id))) return false;
  await db.transact(failedChunk(command, id, message));
  return true;
}

/**
 * Marks the command `done` with a validated `result`; `false` (and no write) if it no longer exists
 * or is already `done`/`failed`.
 */
export async function markDone(db: Db, command: Command, id: string, result: unknown): Promise<boolean> {
  const chunk = doneChunk(command, id, result);
  if (!isOpen(await find(db, command, id))) return false;
  await db.transact(chunk);
  return true;
}
