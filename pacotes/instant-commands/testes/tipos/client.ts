import { sendCommand, subscribeCommand, waitForCommand, type ClientDb, type CommandState } from "../../src/client";
import { defineCommand } from "../../src/index";
import { sortear } from "../sortear";

const reabrir = defineCommand({
  name: "reabrir",
  entity: "reaberturas",
  allow: { create: "true", view: "true" },
});

type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const yes = <_T extends true>() => {};

declare const db: ClientDb;

async function uso() {
  const cid = await sendCommand(db, sortear, { rodada: 1, chave: "k", grupo: "g" });
  subscribeCommand(db, sortear, cid, (state) => {
    yes<Eq<NonNullable<typeof state>["result"], { pares: number } | null>>();
    if (state) yes<Eq<typeof state.result, { pares: number } | null>>();
  });
  // @ts-expect-error id of `sortear` is not an id of `reabrir`
  subscribeCommand(db, reabrir, cid, () => {});
  const done = await waitForCommand(db, sortear, cid);
  yes<Eq<typeof done.result, { pares: number } | null>>();
  // @ts-expect-error missing required fields
  await sendCommand(db, sortear, { grupo: "g" });
}
void uso;
export type _S = CommandState<typeof sortear>;
