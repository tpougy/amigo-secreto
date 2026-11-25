// Recurring jobs that run on the same engine as the handlers.
import type { InstantAdminDatabase, InstantSchemaDef, InstantUnknownSchema } from "@instantdb/admin";
import type { Step } from "./step";

export type ScheduleContext<S extends InstantSchemaDef<any, any, any> = InstantUnknownSchema> = {
  db: InstantAdminDatabase<S>;
  step: Step;
};

export type Schedule<S extends InstantSchemaDef<any, any, any> = InstantUnknownSchema, N extends string = string> = {
  name: N;
  /** Cron expression, evaluated in `timezone` (OpenWorkflow's default when omitted). */
  cron: string;
  timezone?: string;
  /** Also runs once when the runner starts. */
  runOnStart?: boolean;
  run: (ctx: ScheduleContext<S>) => Promise<unknown>;
};

/** Declares a recurring job; hand it to `createRunner({ schedules })`. Its `name` cannot be a command's. */
export function defineSchedule<S extends InstantSchemaDef<any, any, any> = InstantUnknownSchema, const N extends string = string>(
  options: Schedule<S, N>,
): Schedule<S, N> {
  return { ...options };
}
