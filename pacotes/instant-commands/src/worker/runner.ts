// The runner: registers handlers and schedules on the engine, starts it, and turns on the notice
// (webhook or subscription) that dispatches pending commands.
import type { InstantAdminDatabase, InstantSchemaDef } from "@instantdb/admin";
import type { OpenWorkflow } from "openworkflow";
import type { Command } from "../command";
import { CommandDefinitionError } from "../errors";
import { sweep, startPeriodicSweep } from "./dispatch";
import { openWorkflowEngine } from "./engine";
import { registerHandler, type RunnerEvent } from "./execution";
import type { Handler } from "./handler";
import type { Schedule } from "./schedule";
import { startServer } from "./server";
import { createStep } from "./step";
import { startSubscriptionTrigger } from "./subscription";
import { createWebhookHandler, ensureWebhook } from "./webhook";

export type Trigger =
  | {
      type: "webhook";
      /** The address registered in Instant; the route served is its path. */
      publicUrl: string;
      /** `"builtin"` (default) serves the route itself; `"external"` leaves `webhookHandler` to the app's server. */
      server?: "builtin" | "external";
      /** Default: `process.env.PORT`, or 3000. */
      port?: number;
      /** Default: `/health`. */
      healthPath?: string;
      /** Default: 5 minutes. */
      sweepEveryMs?: number;
      /** Default: 64 KB. */
      maxBodyBytes?: number;
    }
  | {
      type: "subscription";
      /** Default: 10 minutes. */
      resubscribeEveryMs?: number;
    };

type AnySchema = InstantSchemaDef<any, any, any>;

type Repeated<Xs extends readonly unknown[]> = {
  [I in keyof Xs]: Xs[I] extends infer V
    ? { [J in keyof Xs]: J extends I ? never : Xs[J] extends V ? (V extends Xs[J] ? V : never) : never }[number]
    : never;
}[number];

type CommandKeys<Hs extends readonly Handler<any, any>[], K extends "name" | "entity"> = {
  [I in keyof Hs]: Hs[I]["command"][K];
};

/** `Hs` when each command has one handler and names and entities are unique; otherwise a readable sentence. */
export type UniqueHandlers<Hs extends readonly Handler<any, any>[]> = [Repeated<CommandKeys<Hs, "name">>] extends [never]
  ? [Repeated<CommandKeys<Hs, "entity">>] extends [never]
    ? Hs
    : `handlers' commands repeat the entity "${Extract<Repeated<CommandKeys<Hs, "entity">>, string>}"`
  : `handlers repeat the command "${Extract<Repeated<CommandKeys<Hs, "name">>, string>}"`;

type ClashingNames<Hs extends readonly Handler<any, any>[], Ss extends readonly Schedule<any, string>[]> = Extract<
  Ss[number]["name"],
  Hs[number]["command"]["name"]
>;

/** `Ss` when no schedule is named like a command; otherwise a readable sentence. */
export type UniqueSchedules<Hs extends readonly Handler<any, any>[], Ss extends readonly Schedule<any, string>[]> = [
  ClashingNames<Hs, Ss>,
] extends [never]
  ? Ss
  : `schedule "${ClashingNames<Hs, Ss>}" has the name of a command`;

export type RunnerOptions<
  S extends AnySchema,
  Hs extends readonly Handler<any, S>[],
  Ss extends readonly Schedule<S, string>[] = readonly Schedule<S>[],
> = {
  ow: OpenWorkflow;
  db: InstantAdminDatabase<S>;
  handlers: Hs & UniqueHandlers<Hs>;
  schedules?: Ss & UniqueSchedules<Hs, Ss>;
  /** Runs at the same time. Default: 2. */
  concurrency?: number;
  trigger: Trigger;
  /** Structured events. An exception thrown here is ignored. */
  onEvent?: (e: RunnerEvent) => void;
};

export type Runner = {
  /** Starts once: a second call returns the first one's promise. */
  start(): Promise<void>;
  /** Stops the notice, then the engine, waiting for runs in flight. */
  stop(): Promise<void>;
  /** The webhook route (`POST`); mount it yourself with `server: "external"`. Answers 404 in subscription mode. */
  webhookHandler: (req: Request) => Promise<Response>;
  /** Port of the builtin server once started (useful with `port: 0`); `undefined` otherwise. */
  readonly port: number | undefined;
};

type WebhookTrigger = Extract<Trigger, { type: "webhook" }>;

/** The webhook options with their defaults applied. */
export function resolveWebhookTrigger(t: WebhookTrigger) {
  return {
    publicUrl: t.publicUrl,
    server: t.server ?? "builtin",
    port: t.port ?? (process.env.PORT ? Number(process.env.PORT) : 3000),
    path: new URL(t.publicUrl).pathname,
    healthPath: t.healthPath ?? "/health",
    sweepEveryMs: t.sweepEveryMs ?? 300_000,
    maxBodyBytes: t.maxBodyBytes ?? 65_536,
  };
}

const DEFAULT_RESUBSCRIBE_MS = 600_000;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function assertRunnable(commands: readonly Command[], schedules: readonly Schedule<any>[]): void {
  const problems: string[] = [];
  const byName = new Map<string, Command>();
  const byEntity = new Map<string, Command>();
  for (const c of commands) {
    const sameName = byName.get(c.name);
    if (sameName) {
      problems.push(
        sameName.entity === c.entity
          ? `command "${c.name}" has more than one handler`
          : `name "${c.name}" is used by more than one command`,
      );
    }
    const sameEntity = byEntity.get(c.entity);
    // Webhook routing maps each entity to one command.
    if (sameEntity && sameEntity.name !== c.name) problems.push(`entity "${c.entity}" is used by more than one command`);
    byName.set(c.name, c);
    byEntity.set(c.entity, c);
  }
  const scheduleNames = new Set<string>();
  for (const s of schedules) {
    if (byName.has(s.name)) problems.push(`schedule "${s.name}" has the name of a command`);
    if (scheduleNames.has(s.name)) problems.push(`schedule "${s.name}" is declared more than once`);
    scheduleNames.add(s.name);
  }
  if (problems.length > 0) throw new CommandDefinitionError("createRunner", problems);
}

/**
 * Creates the worker's runner. Checks (throwing `CommandDefinitionError`) that each command has one
 * handler, that names and entities are unique, and that no schedule is named like a command.
 * Prefer the one returned by `initCommands<AppSchema>()`.
 */
export function createRunner<
  S extends AnySchema,
  const Hs extends readonly Handler<any, S>[],
  const Ss extends readonly Schedule<S, string>[] = [],
>(options: RunnerOptions<S, Hs, Ss>): Runner {
  const handlers = options.handlers as unknown as readonly Handler<any, any>[];
  const schedules = (options.schedules ?? []) as unknown as readonly Schedule<any>[];
  const commands = handlers.map((h) => h.command as Command);
  assertRunnable(commands, schedules);

  const db = options.db as InstantAdminDatabase<any, any>;
  const onEvent = options.onEvent;
  // The app's callback must never throw into the library (it would re-run internal steps).
  const emit = (e: RunnerEvent) => {
    try {
      onEvent?.(e);
    } catch {
      // ignored on purpose
    }
  };
  const engine = openWorkflowEngine(options.ow);
  const trigger = options.trigger;
  const webhook = trigger.type === "webhook" ? resolveWebhookTrigger(trigger) : undefined;
  const resubscribeEveryMs =
    trigger.type === "subscription" ? (trigger.resubscribeEveryMs ?? DEFAULT_RESUBSCRIBE_MS) : DEFAULT_RESUBSCRIBE_MS;
  const webhookHandler = webhook
    ? createWebhookHandler({ db, engine, commands, maxBodyBytes: webhook.maxBodyBytes, emit })
    : async () => new Response("Not found", { status: 404 });

  let started: Promise<void> | undefined;
  let stopped = false;
  let port: number | undefined;
  /** What `stop()` undoes, in start order; undone in reverse. */
  const running: (() => Promise<void> | void)[] = [];

  async function stopAll() {
    while (running.length > 0) await running.pop()!();
  }

  /** A failing sweep (e.g. a query error) is reported instead of swallowed. */
  async function safeSweep(): Promise<number> {
    try {
      return await sweep(db, engine, commands, emit);
    } catch (error) {
      emit({ type: "run.failed", error: messageOf(error) });
      return 0;
    }
  }

  async function startOnce() {
    // 1. Workflows and schedules.
    for (const h of handlers) registerHandler(engine, db, h, emit);
    for (const s of schedules) {
      engine.defineSchedule(s.name, ({ step }) => s.run({ db, step: createStep(step) }), {
        cron: s.cron,
        ...(s.timezone === undefined ? {} : { timezone: s.timezone }),
        ...(s.runOnStart === undefined ? {} : { runOnStart: s.runOnStart }),
      });
    }
    await engine.start({
      concurrency: options.concurrency ?? 2,
      onScheduleError: (name, error) => emit({ type: "run.failed", command: name, error: messageOf(error) }),
    });
    running.push(() => engine.stop());

    // 2. The notice.
    try {
      if (webhook) {
        await ensureWebhook(db, webhook.publicUrl, commands.map((c) => c.entity), emit);
        if (webhook.server === "builtin") {
          const server = startServer({
            port: webhook.port,
            path: webhook.path,
            healthPath: webhook.healthPath,
            maxBodyBytes: webhook.maxBodyBytes,
            handler: webhookHandler,
          });
          port = server.port;
          running.push(async () => {
            port = undefined;
            await server.stop();
          });
        }
        await safeSweep();
        const periodic = startPeriodicSweep(safeSweep, webhook.sweepEveryMs);
        running.push(() => periodic.stop());
      } else {
        const sub = startSubscriptionTrigger(db, engine, commands, { resubscribeEveryMs }, emit);
        running.push(() => sub.stop());
      }
    } catch (error) {
      await stopAll();
      throw error;
    }
  }

  return {
    start() {
      if (stopped) return Promise.reject(new Error("This runner was stopped; create a new one"));
      started ??= startOnce();
      return started;
    },
    async stop() {
      stopped = true;
      if (!started) return;
      await started.catch(() => {});
      await stopAll();
    },
    webhookHandler,
    get port() {
      return port;
    },
  };
}
