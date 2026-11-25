// Status writes of the worker. None of them recreates a deleted command nor overwrites a finished
// one: each queries the id first and writes only if the command still exists and is not terminal.
import { tx, type InstantAdminDatabase, type TransactionChunk } from "@instantdb/admin";
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

export type FailureExtras = (record: Record<string, any>) => Promise<TransactionChunk<any, any>[]>;
export type MarkFailedResult = { written: boolean; extrasError?: string };

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** True when Instant rejected the transaction itself (4xx, except 408 and 429), as opposed to a transient failure. */
export function isInstantRejection(error: unknown): boolean {
  const e = error as { name?: unknown; status?: unknown } | null;
  if (!e || e.name !== "InstantAPIError" || typeof e.status !== "number") return false;
  return e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;
}

/**
 * Marks the command `failed`; `written: false` (and no write, `extras` not called) if it no longer
 * exists or is already `done`/`failed`. `extras` may add chunks written in the SAME transaction; if it
 * throws, or Instant rejects the transaction with them, `failed` is written alone and `extrasError` says why.
 */
export async function markFailed(
  db: Db,
  command: Command,
  id: string,
  message: string,
  extras?: FailureExtras,
): Promise<MarkFailedResult> {
  const row = await find(db, command, id);
  if (!isOpen(row)) return { written: false };
  const failed = failedChunk(command, id, message);
  let chunks: TransactionChunk<any, any>[] = [];
  let extrasError: string | undefined;
  if (extras) {
    try {
      const out = await extras(row as Record<string, any>);
      if (!Array.isArray(out)) throw new Error("the hook did not return an array of transaction chunks");
      chunks = out;
    } catch (e) {
      extrasError = `onFailure: ${errorMessage(e)}`;
    }
  }
  try {
    await db.transact([failed, ...chunks]);
  } catch (e) {
    if (chunks.length === 0 || !isInstantRejection(e)) throw e;
    await db.transact([failed]);
    extrasError = `onFailure rejected: ${errorMessage(e)}`;
  }
  return extrasError === undefined ? { written: true } : { written: true, extrasError };
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
