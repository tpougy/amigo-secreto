import type { InstantAdminDatabase, InstantUnknownSchema, InstantSchemaDef, TransactionChunk } from "@instantdb/admin";
import type { Command } from "../command";
import { CommandDefinitionError } from "../errors";
import type { CommandId, FieldValues, ResultInputOf } from "../types";
import type { RetryPolicy } from "./engine";
import { CommandFailure, fail } from "./failure";
import { doneChunk, failedChunk } from "./status";
import type { Step } from "./step";

export { CommandFailure, fail };

/**
 * Chunk that fails command `id` (for use inside your own transaction, e.g. `db.transact([...])`),
 * stored with `status: "failed"`, `error` and `finishedAt`.
 */
export function failCommand<C extends Command>(command: C, id: string, message: string): TransactionChunk<any, any> {
  return failedChunk(command, id, message);
}

/** Same as `command.complete(result)` for a command known only by id. Validates `result`. */
export function completeChunk<C extends Command>(
  command: C,
  id: string,
  result?: ResultInputOf<C>,
): TransactionChunk<any, any> {
  return doneChunk(command, id, result);
}

export type CommandRecord<C extends Command> = { id: CommandId<C> } & FieldValues<C>;

export type CommandHandle<C extends Command> = CommandRecord<C> & {
  /** Chunk that marks the command `done` with `result` (validated; throws `CommandResultError`). */
  complete(result?: ResultInputOf<C>): TransactionChunk<any, any>;
};

export type HandlerContext<C extends Command, S extends InstantSchemaDef<any, any, any> = InstantUnknownSchema> = {
  db: InstantAdminDatabase<S>;
  command: CommandHandle<C>;
  step: Step;
};

export type FailureReason = "fail" | "error" | "invalid_result" | "invalid_input" | "step_limit";

type FailureBase<S extends InstantSchemaDef<any, any, any>> = { db: InstantAdminDatabase<S>; error: string };

export type FailureContext<C extends Command, S extends InstantSchemaDef<any, any, any> = InstantUnknownSchema> =
  | (FailureBase<S> & { reason: Exclude<FailureReason, "invalid_input">; command: CommandRecord<C> })
  | (FailureBase<S> & {
      reason: "invalid_input";
      command: { id: CommandId<C> } & { [K in keyof FieldValues<C>]?: unknown };
    });

/** Returns chunks committed in the same transaction that marks the command `failed`. */
export type FailureHook<C extends Command, S extends InstantSchemaDef<any, any, any> = InstantUnknownSchema> = (
  ctx: FailureContext<C, S>,
) => TransactionChunk<any, any>[] | Promise<TransactionChunk<any, any>[]>;

export type HandlerOptions<C extends Command = Command, S extends InstantSchemaDef<any, any, any> = InstantUnknownSchema> = {
  version?: string;
  retryPolicy?: RetryPolicy;
  defaultErrorMessage?: string;
  onFailure?: FailureHook<C, S>;
};

export type Handler<C extends Command, S extends InstantSchemaDef<any, any, any> = InstantUnknownSchema> = {
  command: C;
  fn: (ctx: HandlerContext<C, S>) => Promise<ResultInputOf<C> | void>;
  options: HandlerOptions<C, S>;
};

/** Declares what the worker runs for each command of type `command`. */
export function defineHandler<C extends Command, S extends InstantSchemaDef<any, any, any> = InstantUnknownSchema>(
  command: C,
  fn: Handler<C, S>["fn"],
  options: HandlerOptions<C, S> = {},
): Handler<C, S> {
  if (options.onFailure !== undefined && typeof options.onFailure !== "function") {
    throw new CommandDefinitionError(command.name, ["options.onFailure: must be a function"]);
  }
  return { command, fn, options };
}
