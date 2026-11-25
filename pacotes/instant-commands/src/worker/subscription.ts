// Notice by subscription: turns a live query on pending/running commands into engine dispatches,
// reconnecting with backoff and resubscribing periodically as a safety net.
import type { InstantAdminDatabase } from "@instantdb/admin";
import type { Command } from "../command";
import type { Engine } from "./engine";
import type { RunnerEvent } from "./execution";

export type Subscription<T> = (
  onReceive: (items: T[]) => void,
  onError: (e: unknown) => void,
) => { close(): void };

const DEFAULT_BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];

/** Only the error's name: its message may contain data. */
const errorName = (e: unknown) => (e instanceof Error ? e.name : "unknown");

/**
 * Turns a subscription (e.g. Instant's `subscribeQuery`) into `onItems(ids)` calls. Repeated
 * deliveries are normal; idempotency is up to `onItems`. On error it closes and resubscribes after
 * the backoff, which resets on the first successful delivery. A resubscription receives the
 * current state again, so items that piled up during an outage are processed.
 * `resubscribe()` forces a fresh subscription right away.
 */
export function startSubscription(options: {
  name: string;
  subscribe: Subscription<{ id: string }>;
  onItems(ids: string[]): Promise<void>;
  backoffMs?: number[];
  emit(e: RunnerEvent): void;
}): { stop(): void; resubscribe(): void } {
  const backoff = options.backoffMs?.length ? options.backoffMs : DEFAULT_BACKOFF_MS;
  const { name, emit } = options;
  const base = { command: name };
  let stopped = false;
  let failures = 0;
  let current: { close(): void } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let opened = false;

  const closeCurrent = () => {
    try {
      current?.close();
    } catch {
      // closing is best effort
    }
    current = undefined;
  };

  function onFail(mine: number, error: unknown) {
    emit({ type: "subscription.error", ...base, error: errorName(error) });
    if (stopped || mine !== generation) return; // stale subscription or repeated error
    generation++; // invalidates the callbacks of the subscription that dropped
    closeCurrent();
    const wait = backoff[Math.min(failures, backoff.length - 1)]!;
    failures++;
    timer = setTimeout(open, wait);
  }

  async function onReceive(mine: number, items: { id: string }[]) {
    if (stopped || mine !== generation) return;
    failures = 0;
    emit({ type: "delivery", ...base, count: items.length });
    try {
      await options.onItems(items.map((i) => i.id));
    } catch (e) {
      emit({ type: "subscription.error", ...base, error: errorName(e) });
    }
  }

  function open() {
    timer = undefined;
    if (stopped) return;
    const mine = ++generation;
    try {
      current = options.subscribe(
        (items) => void onReceive(mine, items),
        (e) => onFail(mine, e),
      );
    } catch (e) {
      onFail(mine, e);
      return;
    }
    // A synchronous error during subscribe already invalidated the generation: close what just opened.
    if (mine !== generation) closeCurrent();
    else {
      emit({ type: opened ? "resubscribed" : "subscribed", ...base });
      opened = true;
    }
  }

  open();

  return {
    stop() {
      stopped = true;
      generation++;
      if (timer) clearTimeout(timer);
      timer = undefined;
      closeCurrent();
    },
    resubscribe() {
      if (stopped) return;
      generation++;
      if (timer) clearTimeout(timer);
      closeCurrent();
      open();
    },
  };
}

/** Minimal structural shape of the admin SDK that is used. */
type SubscribingDb = {
  subscribeQuery(query: any, cb: (payload: any) => void): { close(): void };
};

/**
 * Adapts `db.subscribeQuery` to `Subscription`. An `ok` payload carries `data: { <entity>: items[] }`;
 * the items of every entity in the query are flattened. An `error` payload calls `onError`.
 */
export function instantSubscription(db: SubscribingDb, query: object): Subscription<{ id: string }> {
  return (onReceive, onError) => {
    const sub = db.subscribeQuery(query, (payload) => {
      if (payload.type === "error") {
        onError(payload.error);
        return;
      }
      const items: { id: string }[] = [];
      for (const v of Object.values(payload.data ?? {})) if (Array.isArray(v)) items.push(...(v as { id: string }[]));
      onReceive(items);
    });
    return { close: () => sub.close() };
  };
}

/**
 * One subscription per command entity on its `pending`/`running` records; every delivered id goes to
 * `engine.dispatch`. All subscriptions are renewed every `resubscribeEveryMs`.
 */
export function startSubscriptionTrigger(
  db: InstantAdminDatabase<any, any>,
  engine: Engine,
  commands: readonly Command[],
  options: { resubscribeEveryMs: number },
  emit: (e: RunnerEvent) => void,
): { stop(): void } {
  const subscriptions = commands.map((command) =>
    startSubscription({
      name: command.name,
      subscribe: instantSubscription(db as unknown as SubscribingDb, {
        [command.entity]: { $: { where: { status: { $in: ["pending", "running"] } } } },
      }),
      onItems: async (ids) => {
        for (const id of ids) {
          try {
            await engine.dispatch(command.name, id);
          } catch (error) {
            emit({ type: "run.failed", error: error instanceof Error ? error.message : String(error) });
          }
        }
      },
      emit,
    }),
  );
  const timer = setInterval(() => {
    for (const s of subscriptions) s.resubscribe();
  }, options.resubscribeEveryMs);
  return {
    stop() {
      clearInterval(timer);
      for (const s of subscriptions) s.stop();
    },
  };
}
