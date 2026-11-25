# instant-commands

Durable commands on top of [Instant](https://instantdb.com), for self-hosted setups.

Instant has no server functions and cannot enqueue work inside a transaction. This library packages
the usual workaround:

1. the client writes a `pending` record (a draw, a reopening, an account deletion);
2. a worker is told about it and runs a durable workflow ([OpenWorkflow](https://openworkflow.dev));
3. the worker writes the outcome on the same record, and the client follows it in real time.

A **command** is declared once, in one file. The library derives the schema entity, the permission
rules, the notice, the dispatch and the client-side tracking from that declaration.

> Status: lives in this repository as a private workspace package (`"private": true`), not
> published. Design: `docs/superpowers/specs/2026-11-25-instant-commands-design.md`.

## Entry points

| Import | What it has | Browser-safe |
|---|---|---|
| `instant-commands` | `defineCommand`, types, error classes | yes |
| `instant-commands/schema` | `commandEntities`, `commandLinks` | yes |
| `instant-commands/perms` | `mergePerms` | yes |
| `instant-commands/client` | `sendCommand`, `subscribeCommand`, `waitForCommand` | yes |
| `instant-commands/worker` | `initCommands` (returns `defineHandler`, `defineSchedule`, `createRunner`), `fail`, `failCommand`, types | no |

The browser-safe entry points never import `@instantdb/admin`, `openworkflow` or anything under
`worker/`. The documentation uses the alias `ic` with a namespace import
(`import * as ic from "instant-commands/worker"`); importing by name works the same.

## Complete example

### 1. The command (shared by the browser and the worker)

```ts
// commands/draw.ts
import { i } from "@instantdb/core";
import { z } from "zod";
import * as ic from "instant-commands";

export const draw = ic.defineCommand({
  name: "draw",          // workflow name in OpenWorkflow and in logs; stable even if the entity is renamed
  entity: "draws",       // where commands live; also the rate limit key
  fields: {
    round: i.number(),
  },
  links: {
    drawGroup: {
      forward: { on: "draws", has: "one", label: "group", onDelete: "cascade" },
      reverse: { on: "groups", has: "many", label: "draws" },
    },
  },
  bind: {
    isOrganizer: "auth.id in data.ref('group.organizer.id')",
  },
  allow: {
    create: "isOrganizer && data.round > 0",
    view: "isOrganizer",
    delete: "isOrganizer", // required by onDelete: "cascade"
    link: { group: "auth.id in linkedData.ref('organizer.id')" },
  },
  rateLimit: { limits: [{ capacity: 5, refill: { amount: 5, period: "1 hour", type: "greedy" } }] },
  result: z.object({ pairs: z.number().int() }), // or i.json<{ pairs: number }>() for a type only
});
```

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | workflow name |
| `entity` | yes | Instant entity that stores the commands |
| `fields` | no | input values, as Instant `i.*` builders; they become entity attributes |
| `links` | no | inputs that point at existing records, in Instant's link format. Each needs `forward.on === entity` and `forward.has === "one"` |
| `bind` | no | CEL aliases, as in `perms.ts` |
| `allow.create` / `allow.view` | yes | who may create and see commands |
| `allow.delete` | no (`"false"`); required with `onDelete: "cascade"` | who may delete |
| `allow.link` | no | per link (key = `forward.label`), an extra check on `linkedData` at creation |
| `rateLimit` | no | an Instant `$rateLimits` bucket, applied per user |
| `result` | no (result is `null`) | `i.json<T>()` (type only) or a Standard Schema (zod, valibot, arktype), which also validates at runtime |

`defineCommand` validates the declaration when the module loads and throws `CommandDefinitionError`
with a readable message (reserved field names, `update`/`unlink` rules, unknown identifiers in
`allow`, `data.ref('...')` with a first segment that is not a link or field, and so on).

Standard attributes are added to every command entity: `status`
(`"pending" | "running" | "done" | "failed"`), `error`, `result`, `attempts`, `createdAt`,
`finishedAt`. These names, and `id`, are reserved in `fields`.

### 2. Schema and permissions

```ts
// instant.schema.ts
import { i } from "@instantdb/core";
import { commandEntities, commandLinks } from "instant-commands/schema";
import { draw } from "./commands/draw";

const commands = [draw] as const;

const _schema = i.schema({
  entities: {
    $users: i.entity({ email: i.string().unique().indexed().optional() }),
    groups: i.entity({ title: i.string(), status: i.string() }),
    ...commandEntities(commands),
  },
  links: {
    groupOrganizer: {
      forward: { on: "groups", has: "one", label: "organizer" },
      reverse: { on: "$users", has: "many", label: "organizedGroups" },
    },
    ...commandLinks(commands),
  },
});
type _AppSchema = typeof _schema;
export interface AppSchema extends _AppSchema {}
export const schema: AppSchema = _schema;
```

```ts
// instant.perms.ts
import type { InstantRules } from "@instantdb/core";
import { mergePerms } from "instant-commands/perms";
import { draw } from "./commands/draw";
import type { AppSchema } from "./instant.schema";

const basePerms = {
  groups: {
    allow: { view: "true", create: "isOwner", update: "isOwner", delete: "isOwner" },
    bind: { isOwner: "auth.id in data.ref('organizer.id')" },
  },
} satisfies InstantRules<AppSchema>;

export default mergePerms(basePerms, [draw] as const);
```

`mergePerms` returns `basePerms` plus, for each command:

- `create`: `rateLimit.<entity>.limit(auth.id) && (<allow.create>) && data.status == 'pending' && data.attempts == 0`
  (the rate limit comes first, so even denied attempts spend a token);
- `update: "false"` and `unlink: "false"`: only the worker, as admin, changes the status;
- `link` on the command side is allowed only at creation (`actions.data == 'create'`), plus your `allow.link` check;
- the reverse side of each link gets `link`/`unlink` set to `"true"`;
- `$rateLimits.<entity>` when the command has a `rateLimit`.

It does not mutate `basePerms`. If `basePerms` already defines the command's entity, its rate limit
key, or a generated `link`/`unlink` rule, it fails (at compile time with a readable sentence, and at
runtime with `CommandDefinitionError`).

### 3. The worker

```ts
// worker/commands.ts: binds the app schema once
import * as ic from "instant-commands/worker";
import type { AppSchema } from "../instant.schema";

export const { defineHandler, defineSchedule, createRunner } = ic.initCommands<AppSchema>();
export type Ctx<C extends ic.Command> = ic.HandlerContext<C, AppSchema>;
```

```ts
// worker/handlers/draw.ts
import * as ic from "instant-commands/worker";
import { draw } from "../../commands/draw";
import { defineHandler, type Ctx } from "../commands";

async function loadGroup(db: Ctx<typeof draw>["db"], drawId: string) {
  const { draws } = await db.query({ draws: { $: { where: { id: drawId } }, group: {} } });
  return draws[0]?.group ?? null;
}

async function applyDraw(db: Ctx<typeof draw>["db"], command: Ctx<typeof draw>["command"], groupId: string) {
  // The business write and the completion go in one transaction.
  await db.transact([
    db.tx.groups[groupId].update({ status: "drawn" }),
    command.complete({ pairs: 12 }),
  ]);
}

async function runDraw({ db, command, step }: Ctx<typeof draw>) {
  const group = await step.run("load", loadGroup, db, command.id);
  if (!group) ic.fail("The group no longer exists"); // narrows `group`
  await step.run("apply", applyDraw, db, command, group.id);
}

export const drawHandler = defineHandler(draw, runDraw, { version: "1" });
```

```ts
// worker/main.ts
import { init } from "@instantdb/admin";
import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";
import type * as ic from "instant-commands/worker";
import { schema, type AppSchema } from "../instant.schema";
import { createRunner, defineSchedule } from "./commands";
import { drawHandler } from "./handlers/draw";

const db = init({
  appId: process.env.INSTANT_APP_ID!,
  adminToken: process.env.INSTANT_ADMIN_TOKEN!,
  apiURI: process.env.INSTANT_API_URI,
  schema,
});
const ow = new OpenWorkflow({ backend: BackendSqlite.connect("/data/ow.db") });

async function countGroups({ db }: ic.ScheduleContext<AppSchema>) {
  const { groups } = await db.query({ groups: {} });
  return groups.length;
}
const stats = defineSchedule({ name: "count-groups", cron: "0 * * * *", run: countGroups });

function logEvent(event: ic.RunnerEvent) {
  console.log(JSON.stringify(event));
}

const runner = createRunner({
  ow,
  db,
  handlers: [drawHandler],
  schedules: [stats],
  trigger: { type: "webhook", publicUrl: process.env.WEBHOOK_URL! }, // https://my-worker.app.example/ic/hook
  onEvent: logEvent,
});
await runner.start();
process.on("SIGTERM", () => void runner.stop().then(() => process.exit(0)));
```

**How a command ends**

- `ic.fail(message)` ends it as `failed`, with `message` in `error`, and is never retried (also when
  called inside a step). Only messages you pass to `fail` or `failCommand` reach the database.
- `ic.failCommand(command, id, message)` returns a transaction chunk that marks *another* command
  `failed` (e.g. pending siblings), for use in your own `db.transact`.
- An unexpected exception, once the step's retries are exhausted, ends it as `failed` with the
  generic `defaultErrorMessage` (default `"Could not complete the command"`, configurable in
  `defineHandler` options). The exception's own message goes only to `onEvent`.
- `command.complete(result?)` returns a chunk (`done`, `result`, `finishedAt`) to put in the same
  `db.transact` as the business write. If the handler returns without calling it, the library
  writes `done` itself, using the returned value as `result`.
- A command that is already `done` or `failed` is never overwritten by the library.

`defineHandler(command, fn, { version, retryPolicy, defaultErrorMessage })`: `version` is the
OpenWorkflow workflow version; change it when steps change incompatibly.

`step.run(name, fn, ...args)` runs `fn(...args)` as a durable step (also
`step.run({ name, retryPolicy }, fn, ...args)`). `args` are checked against `fn`'s parameters.
The return value is stored as JSON and typed as such (a `Date` comes back as a `string`).

### 4. The client

```ts
import { init } from "@instantdb/core";
import * as ic from "instant-commands/client";
import { draw } from "./commands/draw";
import { schema } from "./instant.schema";

const db = init({ appId: "app-id", schema });

function showState(state: ic.CommandState<typeof draw>) {
  if (state === null) return; // the command is gone
  if (state.status === "done") console.log(state.result?.pairs);
  if (state.status === "failed") console.log(state.error);
}

async function onDrawClick(groupId: string) {
  const id = await ic.sendCommand(db, draw, { group: groupId, round: 1 });
  const stop = ic.subscribeCommand(db, draw, id, showState);
  const final = await ic.waitForCommand(db, draw, id, { timeoutMs: 30_000 }); // for scripts and tests
  stop();
  return final;
}
```

- `sendCommand(db, command, input)` validates `input` (throws `CommandInputError` before reaching
  the server), writes a `pending` command with its links, and returns a branded `CommandId`. If a
  rule denies it, Instant's error is passed through.
- `subscribeCommand(db, command, id, callback)` calls back on every change (state is `null` if the
  command disappears) and returns the unsubscribe function. The `result` is validated; if it fails,
  `result` is `null` and `resultIssues` lists the problems.
- `waitForCommand` resolves with the final state (`done` or `failed`), and rejects on timeout
  (default 30 s) or if the command disappears.
- They work with `@instantdb/core` and the packages that wrap it (React, Svelte); they use only
  `transact` and `subscribeQuery`.

## The two notice modes

Both only change *how the runner learns* that commands are pending. Checking, dispatching and
handlers are the same. Set it with `trigger`.

| | `webhook` (default for production) | `subscription` |
|---|---|---|
| How | Instant POSTs a signed notice to the worker for each created command | the worker subscribes to the pending commands over WebSocket |
| Needs | a public HTTPS address for the worker | nothing beyond the admin token |
| Safety net | sweep on start and every `sweepEveryMs` (default 5 min) | re-subscribe every `resubscribeEveryMs` (default 10 min); errors re-subscribe with backoff 1, 2, 5, 10, 30 s |
| Use | production | local development, tests, no public address |

```ts
trigger: { type: "webhook", publicUrl: "https://my-worker.app.example/ic/hook" }
trigger: { type: "subscription" }
```

Webhook options (only `publicUrl` is required):

| Option | Default |
|---|---|
| `publicUrl` | required; the address registered in Instant. The route served is its path |
| `server` | `"builtin"`: `runner.start()` runs a `Bun.serve` with `POST <path>` and `GET <healthPath>`. `"external"`: no server; mount `runner.webhookHandler` (`(req: Request) => Promise<Response>`) in your own |
| `port` | `process.env.PORT`, or `3000` |
| `healthPath` | `/health` |
| `sweepEveryMs` | `300_000` |
| `maxBodyBytes` | `65_536` (larger bodies get `413`) |

On `runner.start()` the webhook is registered in Instant (`ensureWebhook`): it finds the webhook for
`publicUrl` and creates, updates or re-enables it, with `namespaces` equal to the entities of the
registered handlers and `actions: ["create"]`. A new command needs no change in Instant. The route
answers `401` for an invalid signature, `413` for a large body, `503` when dispatching fails (Instant
retries), and never `410` (Instant would disable the webhook). The notice is only a bell: just the id
is used and the command is re-read from the database.

`runner.port` is the builtin server's port once started (useful with `port: 0`).

`onEvent(event)` receives structured events (`webhook.ensured`, `webhook.received`,
`webhook.rejected`, `sweep`, `subscribed`, `resubscribed`, `delivery`, `run.started`, `run.done`,
`run.failed`, `run.skipped`, `run.invalid_input`, `subscription.error`). Events never carry command
fields other than the id.

`createRunner` checks (throws `CommandDefinitionError`; the same mistakes are compile errors) that
each command has one handler, that names and entities are unique, and that no schedule is named like
a command.

## Deployment (webhook mode)

**Never enable `INSTANT_WEBHOOK_ALLOW_INSECURE` on the Instant server.** It is global to every app on
that server: a leaked admin token from any project would become access to your internal network
(Instant would POST to internal services, and the first 256 characters of each response are stored in
the event history, readable with the same token).

**One project = one worker = one domain = one webhook.** No central webhook router.

| Project | Worker | `WEBHOOK_URL` |
|---|---|---|
| `<project>` | `<project>-worker` | `https://<project>-worker.app.example/ic/hook` |

- The worker is called only by Instant; browsers never talk to it.
- Restrict the worker's reverse proxy to the address Instant calls from, so the internet gets `403`.
  Example for nginx on Dokku (`/home/dokku/<app>/nginx.conf.d/only-the-host.conf`, then
  `dokku proxy:build-config <app>`):

  ```nginx
  allow 172.17.0.0/16;
  deny all;
  ```

  The range is a coarse filter: it is the Docker bridge, so any container on that host passes. The
  real protection is the **Ed25519 signature**, which the route always verifies. Use the whole
  `/16` and not the single container IP, which changes if the Instant container is recreated; if
  Instant runs on a custom Docker network, check the source IP in the app's nginx access log.
- The worker serves only the webhook route and the health path, so restricting the whole app is fine.
  `/health` is then `403` from outside too; Dokku's deploy checks run internally.
- Keep the OpenWorkflow database on a persistent volume (`/data/ow.db` above).
- Test on this setup: the command reached `done` in under 10 s; with the worker stopped, the command
  stayed `pending` and was completed by the start-up sweep (under 30 s) after restart.

## Known limitations and notes

- **No compare-and-set in Instant.** In rare cases two runs of the same command can overlap, and a
  step can be repeated after a crash. Handlers must tolerate re-execution. Before writing on behalf
  of a command, re-read it (`command.complete()` inside a `transact` does an `update` on an id that
  may have been deleted meanwhile).
- **`fail` must be imported** (`import { fail }`) or used as `ic.fail`, never destructured from the
  handler context, or TypeScript will not narrow after `if (!x) fail(...)`. It is not offered in the
  context for that reason.
- **`result` Standard Schemas must validate synchronously.** A schema that returns a `Promise` is a
  definition error.
- **An invalid result from `command.complete()` inside a step surfaces only after that step's
  retries.** Call `validateResult(command, value)` first to fail fast.
- **`onEvent` may receive exception messages.** Treat it as sensitive (logs, not the client). Do not
  rely on it to throw: exceptions in it are swallowed.
- **A failed `runner.start()` cannot be retried in the same process.** Restart the process.
- **The nginx `allow` rule is a coarse filter.** The Ed25519 signature is the real protection.
- **Spreading `commandEntities` / `commandLinks` silently overwrites** an app entity or link with the
  same name. `mergePerms` catches the entity when it has rules, but not a link or an entity without
  rules. Do not reuse names.
- **TypeScript 6.0.x with `@instantdb/core` 1.0.67** types attribute values in query results as
  `any` (entity names and keys stay typed). With TypeScript 5.9 they are fully typed.
- **Use the `defineSchedule` returned by `initCommands`**: it gets compile-time name checks against
  the handlers' commands.
- Type a handler declared as a separate function with the `Ctx` alias above:
  `HandlerContext<C>` without the schema parameter has a `db` of unknown schema.

## Tests

```sh
bun run test   # tsc --noEmit, unit tests and integration tests against a dedicated Instant test app
```

Integration tests need `IC_TEST_APP_ID` and `IC_TEST_ADMIN_TOKEN` (app `instant-commands-teste`) in
the repository's root env file. The webhook end-to-end test (`testes/e2e`) runs on a real host and is
not part of `bun run test`. The README's main example is compiled by `testes/tipos/readme.ts`.
