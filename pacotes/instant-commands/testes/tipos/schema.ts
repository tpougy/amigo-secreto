import { i, type InstaQLEntity } from "@instantdb/core";
import { defineCommand, commandEntities, commandLinks } from "../../src/index";
import { sortear } from "../sortear";

const reabrir = defineCommand({
  name: "reabrir",
  entity: "reaberturas",
  fields: { motivo: i.string() },
  allow: { create: "true", view: "true" },
});

export const s = i.schema({
  entities: { grupos: i.entity({ titulo: i.string() }), ...commandEntities([sortear, reabrir]) },
  links: { ...commandLinks([sortear, reabrir]) },
});

type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const yes = <_T extends true>() => {};

type Sorteio = InstaQLEntity<typeof s, "sorteios">;
yes<Eq<Sorteio["status"], "pending" | "running" | "done" | "failed">>();
yes<Eq<Sorteio["rodada"], number>>();
yes<Eq<Sorteio["result"], { pares: number } | undefined>>();

// @ts-expect-error commands repeat the entity "sorteios"
export const dup = commandEntities([sortear, sortear]);
