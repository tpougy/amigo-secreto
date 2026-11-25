import type { InstantAdminDatabase } from "@instantdb/admin";
import type { OpenWorkflow } from "openworkflow";
import { defineCommand, type Command } from "../../src/index";
import * as ic from "../../src/worker";
import { defineSchedule, initCommands } from "../../src/worker";
import { reabrir, sortear } from "../app/commands";
import type { TestSchema } from "../app/schema";

type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const yes = <_T extends true>() => {};

declare const ow: OpenWorkflow;
declare const db: InstantAdminDatabase<TestSchema>;

const { defineHandler, createRunner, defineSchedule: defineAppSchedule } = initCommands<TestSchema>();

// The context's db carries the app schema.
const h1 = defineHandler(sortear, async ({ db }) => {
  const { grupos } = await db.query({ grupos: {} });
  // (attribute values of the test schema come out as `any`; the entity's shape is what is checked)
  yes<Eq<keyof (typeof grupos)[number], "id" | "status" | "titulo">>();
  // @ts-expect-error not an entity of the schema
  await db.query({ naoExiste: {} });
  return { pares: grupos.length };
});

// The app-side alias for handlers declared as separate named functions.
type Ctx<C extends Command> = ic.HandlerContext<C, TestSchema>;

async function executar(ctx: Ctx<typeof sortear>) {
  const { grupos } = await ctx.db.query({ grupos: {} });
  yes<Eq<keyof (typeof grupos)[number], "id" | "status" | "titulo">>();
  return { pares: grupos.length + ctx.command.rodada };
}
const h2 = defineHandler(sortear, executar);
const h3 = defineHandler(reabrir, async () => {});

createRunner({ ow, db, handlers: [h1, h3], trigger: { type: "subscription" } });
createRunner({ ow, db, handlers: [h2, h3], trigger: { type: "webhook", publicUrl: "https://w.example/ic/hook" } });

// @ts-expect-error the same command handled twice
createRunner({ ow, db, handlers: [h1, h1], trigger: { type: "subscription" } });

// @ts-expect-error two handlers for the same command
createRunner({ ow, db, handlers: [h1, h2], trigger: { type: "subscription" } });

const twin = defineCommand({ name: "twin", entity: "sorteios", fields: {}, allow: { create: "true", view: "true" } });
// @ts-expect-error two commands share an entity
createRunner({ ow, db, handlers: [h1, defineHandler(twin, async () => {})], trigger: { type: "subscription" } });

const contar = defineSchedule<TestSchema>({
  name: "contar",
  cron: "0 * * * *",
  run: async ({ db, step }) => {
    const { grupos } = await db.query({ grupos: {} });
    yes<Eq<keyof (typeof grupos)[number], "id" | "status" | "titulo">>();
    return step.run("n", () => grupos.length);
  },
});
createRunner({ ow, db, handlers: [h1], schedules: [contar], trigger: { type: "subscription" } });

// The bound `defineSchedule` keeps the name literal, so a clash is a type error.
const clash = defineAppSchedule({ name: "sortear", cron: "0 * * * *", run: async () => null });
// @ts-expect-error a schedule named like a command
createRunner({ ow, db, handlers: [h1], schedules: [clash], trigger: { type: "subscription" } });

// @ts-expect-error trigger needs publicUrl in webhook mode
createRunner({ ow, db, handlers: [h1], trigger: { type: "webhook" } });
