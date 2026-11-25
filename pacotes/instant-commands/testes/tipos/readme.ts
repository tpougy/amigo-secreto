// The README's main example, file by file, with imports pointing at src/ (the README uses the
// package names). Compiled by `tsc --noEmit -p .`; keep it in sync with README.md.
import { i, init as initClient } from "@instantdb/core";
import { init as initAdmin } from "@instantdb/admin";
import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";
import { z } from "zod";

// ---- commands/draw.ts ------------------------------------------------------------------------
import * as icDef from "../../src/index";

export const draw = icDef.defineCommand({
  name: "draw",
  entity: "draws",
  fields: {
    round: i.number(),
    key: i.string().unique(), // `<groupId>:<round>`: one draw per group and round
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
  result: z.object({ pairs: z.number().int() }),
});

// ---- instant.schema.ts and instant.perms.ts --------------------------------------------------
import { commandEntities, commandLinks } from "../../src/schema";
import { mergePerms } from "../../src/perms";
import type { InstantRules } from "@instantdb/core";

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

const basePerms = {
  groups: {
    allow: {
      view: "true",
      create: "isOwner",
      update: "isOwner",
      delete: "isOwner",
    },
    bind: { isOwner: "auth.id in data.ref('organizer.id')" },
  },
} satisfies InstantRules<AppSchema>;

export const perms = mergePerms(basePerms, commands);

// ---- worker/commands.ts ----------------------------------------------------------------------
import * as icWorker from "../../src/worker";

export const { defineHandler, defineSchedule, createRunner } = icWorker.initCommands<AppSchema>();
export type Ctx<C extends icWorker.Command> = icWorker.HandlerContext<C, AppSchema>;

// ---- worker/handlers/draw.ts -----------------------------------------------------------------
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
  if (!group) icWorker.fail("The group no longer exists"); // narrows `group`
  await step.run("apply", applyDraw, db, command, group.id);
}

// Runs in the same transaction that marks the command `failed`, on every failure path. It releases
// the reservation the command holds (its unique `key`) so the same draw can be sent again. Do not
// roll back business state here (the command's effects may never have happened) and keep side
// effects in `onEvent`.
function releaseKey({ db, command }: icWorker.FailureContext<typeof draw, AppSchema>) {
  return [db.tx.draws[command.id].update({ key: `${command.key}:failed:${command.id}` })];
}

export const drawHandler = defineHandler(draw, runDraw, { version: "1", onFailure: releaseKey });

// ---- worker/main.ts --------------------------------------------------------------------------
const db = initAdmin({
  appId: process.env.INSTANT_APP_ID!,
  adminToken: process.env.INSTANT_ADMIN_TOKEN!,
  apiURI: process.env.INSTANT_API_URI,
  schema,
});
const ow = new OpenWorkflow({ backend: BackendSqlite.connect("/data/ow.db") });

async function countGroups({ db }: icWorker.ScheduleContext<AppSchema>) {
  const { groups } = await db.query({ groups: {} });
  return groups.length;
}
const stats = defineSchedule({ name: "count-groups", cron: "0 * * * *", run: countGroups });

function logEvent(event: icWorker.RunnerEvent) {
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

// ---- client ----------------------------------------------------------------------------------
import * as icClient from "../../src/client";

const clientDb = initClient({ appId: "app-id", schema });

function showState(state: icClient.CommandState<typeof draw>) {
  if (state === null) return; // the command is gone
  if (state.status === "done") console.log(state.result?.pairs);
  if (state.status === "failed") console.log(state.error);
}

export async function onDrawClick(groupId: string) {
  const id = await icClient.sendCommand(clientDb, draw, { group: groupId, round: 1, key: `${groupId}:1` });
  const stop = icClient.subscribeCommand(clientDb, draw, id, showState);
  const final = await icClient.waitForCommand(clientDb, draw, id, { timeoutMs: 30_000 });
  stop();
  return final;
}

// This file is only compiled, never executed.
await runner.start();
process.on("SIGTERM", () => void runner.stop().then(() => process.exit(0)));
