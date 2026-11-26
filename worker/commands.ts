// Liga o schema do amigo-secreto à biblioteca `instant-commands` uma vez só: handlers e schedules
// do worker recebem um `db` admin tipado.
import * as ic from "instant-commands/worker";
import type { AppSchema } from "@amigo/instant";

export const { defineHandler, defineSchedule, createRunner } = ic.initCommands<AppSchema>();

/** Contexto de um handler declarado como função separada (`Ctx<typeof reabertura>`). */
export type Ctx<C extends ic.Command> = ic.HandlerContext<C, AppSchema>;
