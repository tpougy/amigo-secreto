// Dispatching pending commands to the engine: the sweep and its periodic timer.
import type { InstantAdminDatabase } from "@instantdb/admin";
import type { Command } from "../command";
import type { Engine } from "./engine";
import type { RunnerEvent } from "./execution";

/**
 * One-off query of every `pending`/`running` command of each entity, dispatching each id to the
 * engine (which deduplicates by id). A failing dispatch is reported and does not stop the others.
 * Returns how many ids were dispatched successfully.
 */
export async function sweep(
  db: InstantAdminDatabase<any, any>,
  engine: Engine,
  commands: readonly Command[],
  emit: (e: RunnerEvent) => void,
): Promise<number> {
  let count = 0;
  for (const command of commands) {
    const result = (await db.query({
      [command.entity]: { $: { where: { status: { $in: ["pending", "running"] } } } },
    } as any)) as Record<string, { id: string }[]>;
    for (const { id } of result[command.entity] ?? []) {
      try {
        await engine.dispatch(command.name, id);
        count++;
      } catch (error) {
        emit({ type: "run.failed", error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  emit({ type: "sweep", count });
  return count;
}

/** Runs `run` every `everyMs`; a tick is skipped while the previous run is still going. */
export function startPeriodicSweep(run: () => Promise<number>, everyMs: number): { stop(): void } {
  let busy = false;
  let stopped = false;
  const timer = setInterval(() => {
    if (busy || stopped) return;
    busy = true;
    run()
      .catch(() => {})
      .finally(() => {
        busy = false;
      });
  }, everyMs);
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
