import { i } from "@instantdb/core";
import { defineCommand, type ResultOf, type ResultInputOf } from "../../src/index";
import { sortear } from "../sortear";

const cmdJson = defineCommand({
  name: "j",
  entity: "js",
  allow: { create: "true", view: "true" },
  result: i.json<{ n: number }>(),
});
const cmdSem = defineCommand({ name: "s", entity: "ss", allow: { create: "true", view: "true" } });

type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const yes = <_T extends true>() => {};

yes<Eq<ResultOf<typeof sortear>, { pares: number }>>();
yes<Eq<ResultInputOf<typeof sortear>, { pares: number }>>();
yes<Eq<ResultOf<typeof cmdJson>, { n: number }>>();
yes<Eq<ResultInputOf<typeof cmdJson>, { n: number }>>();
yes<Eq<ResultOf<typeof cmdSem>, null>>();
yes<Eq<ResultInputOf<typeof cmdSem>, null>>();
