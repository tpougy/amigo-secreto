import type { InstantAdminDatabase } from "@instantdb/admin";
import * as ic from "../../src/worker";
import { defineHandler, fail, type CommandHandle } from "../../src/worker";
import { sortear } from "../app/commands";
import type { TestSchema } from "../app/schema";

type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const yes = <_T extends true>() => {};

declare const g: { id: string } | undefined;

function _narrowing() {
  if (!g) fail("x");
  g.id;
}

function _narrowingNamespace() {
  if (!g) ic.fail("x");
  g.id;
}

defineHandler(sortear, async ({ command, step }) => {
  yes<Eq<typeof command.rodada, number>>();
  yes<Eq<typeof command.chave, string>>();
  const n = await step.run("n", () => 3);
  yes<Eq<typeof n, number>>();
  command.complete({ pares: 3 });
  // @ts-expect-error wrong result type
  command.complete({ pares: "3" });
  return { pares: n };
});

// @ts-expect-error handler result must match the command's result
defineHandler(sortear, async () => ({ pares: "x" }));

declare const h: CommandHandle<typeof sortear>;
yes<Eq<typeof h.id, string & { readonly __command: "sortear" }>>();

defineHandler(sortear, async () => {}, {
  onFailure: (ctx) => {
    if (ctx.reason === "invalid_input") {
      yes<Eq<typeof ctx.command.chave, unknown>>();
      return [];
    }
    yes<Eq<typeof ctx.command.chave, string>>();
    yes<Eq<typeof ctx.error, string>>();
    return [ctx.db.tx.sorteios[ctx.command.id]!.update({ chave: `${ctx.command.chave}:erro` })];
  },
});
// @ts-expect-error must return transaction chunks
defineHandler(sortear, async () => {}, { onFailure: () => "x" });
// async hook is accepted
defineHandler(sortear, async () => {}, { onFailure: async () => [] });

// Bound to the app schema: ctx.db carries it.
const { defineHandler: defineAppHandler } = ic.initCommands<TestSchema>();
defineAppHandler(sortear, async () => {}, {
  onFailure: (ctx) => {
    yes<Eq<typeof ctx.db, InstantAdminDatabase<TestSchema>>>();
    if (ctx.reason === "invalid_input") {
      yes<Eq<typeof ctx.command.chave, unknown>>();
      return [];
    }
    yes<Eq<typeof ctx.command.chave, string>>();
    yes<Eq<typeof ctx.error, string>>();
    return [ctx.db.tx.sorteios[ctx.command.id]!.update({ chave: `${ctx.command.chave}:erro` })];
  },
});
// @ts-expect-error must return transaction chunks
defineAppHandler(sortear, async () => {}, { onFailure: () => "x" });
// async hook is accepted
defineAppHandler(sortear, async () => {}, { onFailure: async () => [] });
