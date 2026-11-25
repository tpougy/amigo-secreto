import { i, type InstantRules } from "@instantdb/core";
import { commandEntities, commandLinks } from "../../src/schema";
import { mergePerms } from "../../src/perms";
import { sortear } from "../sortear";

const s = i.schema({
  entities: { grupos: i.entity({ titulo: i.string() }), ...commandEntities([sortear]) },
  links: { ...commandLinks([sortear]) },
});

const base = { grupos: { allow: { view: "true", link: {}, unlink: {} } } } satisfies InstantRules<typeof s>;

export const merged: InstantRules<typeof s> = mergePerms(base, [sortear]);
export const withSystem = mergePerms({ ...base, $streams: { allow: { view: "false" } } }, [sortear]).$streams;

// @ts-expect-error perms already defines "sorteios", which belongs to a command
export const conflict = mergePerms({ sorteios: { allow: { view: "true" } } }, [sortear]);
