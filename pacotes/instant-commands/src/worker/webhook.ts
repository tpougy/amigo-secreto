// Notice by webhook: the route handler and the registration of the webhook in Instant.
import type { InstantAdminDatabase } from "@instantdb/admin";
import type { Command } from "../command";
import type { Engine } from "./engine";
import type { RunnerEvent } from "./execution";

type Db = InstantAdminDatabase<any, any>;

const text = (status: number, body: string) => new Response(body, { status });

/** Reads the body; `false` as soon as it passes `max` bytes. */
async function readLimited(body: ReadableStream<Uint8Array> | null, max: number): Promise<boolean> {
  if (!body) return true;
  const reader = body.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return true;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return false;
    }
  }
}

/**
 * Handler of the webhook route: 413 above `maxBodyBytes`, 401 on a bad signature, 503 when the
 * payloads cannot be fetched or a dispatch fails (Instant redelivers), 200 otherwise. Only `create`
 * records of command entities are dispatched. Never answers 410.
 */
export function createWebhookHandler(options: {
  db: Db;
  engine: Engine;
  commands: readonly Command[];
  maxBodyBytes: number;
  emit: (e: RunnerEvent) => void;
}): (req: Request) => Promise<Response> {
  const { db, engine, commands, maxBodyBytes, emit } = options;
  const byEntity = new Map(commands.map((c) => [c.entity, c.name]));

  return async (req) => {
    const declared = req.headers.get("content-length");
    if (declared !== null && Number(declared) > maxBodyBytes) return text(413, "Payload too large");

    // Validation consumes the body; a chunked one is measured on a clone first.
    if (declared === null && !(await readLimited(req.clone().body, maxBodyBytes))) return text(413, "Payload too large");

    let body;
    try {
      body = await db.webhooks.validateRequest(req);
    } catch {
      emit({ type: "webhook.rejected" });
      return text(401, "Invalid signature");
    }

    try {
      const { data } = await db.webhooks.fetchPayloads(body);
      const targets = data.filter((r) => r.action === "create" && byEntity.has(r.namespace));
      for (const r of targets) await engine.dispatch(byEntity.get(r.namespace)!, r.id);
      emit({ type: "webhook.received", count: targets.length });
      return text(200, "ok");
    } catch {
      return text(503, "Unavailable");
    }
  };
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Makes sure Instant has an active webhook to `publicUrl` for `entities` (create only); returns its id. */
export async function ensureWebhook(
  db: Db,
  publicUrl: string,
  entities: string[],
  emit: (e: RunnerEvent) => void,
): Promise<string> {
  const manager = db.webhooks.manager;
  const actions = ["create"] as const;
  const existing = (await manager.list()).find((w) => w.sink.url === publicUrl);
  let id: string;
  if (!existing) {
    id = (await manager.create({ url: publicUrl, namespaces: entities, actions: [...actions] })).id;
  } else {
    id = existing.id;
    if (!sameSet(existing.namespaces, entities) || !sameSet(existing.actions as string[], actions)) {
      await manager.update(id, { namespaces: entities, actions: [...actions] });
    }
    if (existing.status === "disabled") await manager.enable(id);
  }
  emit({ type: "webhook.ensured" });
  return id;
}
