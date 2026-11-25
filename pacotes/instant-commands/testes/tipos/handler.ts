import * as ic from "../../src/worker";
import { defineHandler, fail, type CommandHandle } from "../../src/worker";
import { sortear } from "../app/commands";

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
