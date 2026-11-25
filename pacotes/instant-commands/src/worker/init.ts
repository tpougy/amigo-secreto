// `initCommands<AppSchema>()`: binds the app schema once, so handlers and schedules get a typed `db`.
import type { InstantSchemaDef } from "@instantdb/admin";
import type { Command } from "../command";
import type { ResultInputOf } from "../types";
import { defineHandler, type Handler, type HandlerContext, type HandlerOptions } from "./handler";
import { createRunner, type Runner, type RunnerOptions } from "./runner";
import { defineSchedule, type Schedule } from "./schedule";

/**
 * Returns `defineHandler`, `defineSchedule` and `createRunner` bound to the app schema `S`: the
 * `db` in their contexts is `InstantAdminDatabase<S>`.
 *
 * ```ts
 * // worker/commands.ts
 * export const { defineHandler, defineSchedule, createRunner } = ic.initCommands<AppSchema>();
 * export type Ctx<C extends ic.Command> = ic.HandlerContext<C, AppSchema>;
 *
 * // worker/handlers/sortear.ts
 * async function executar({ db, command, step }: Ctx<typeof sortear>) { ... }
 * export const sortearHandler = defineHandler(sortear, executar);
 * ```
 *
 * For a handler declared as a separate function, type its context with an alias like `Ctx`
 * above: `HandlerContext<C>` without the schema parameter has a `db` of unknown schema.
 */
export function initCommands<S extends InstantSchemaDef<any, any, any>>() {
  return {
    defineHandler: <C extends Command>(
      command: C,
      fn: (ctx: HandlerContext<C, S>) => Promise<ResultInputOf<C> | void>,
      options?: HandlerOptions<C, S>,
    ): Handler<C, S> => defineHandler<C, S>(command, fn, options),
    defineSchedule: <const N extends string>(options: Schedule<S, N>): Schedule<S, N> => defineSchedule<S, N>(options),
    createRunner: <const Hs extends readonly Handler<any, S>[], const Ss extends readonly Schedule<S, string>[] = []>(
      options: RunnerOptions<S, Hs, Ss>,
    ): Runner => createRunner<S, Hs, Ss>(options),
  };
}
