import { i, type InstantRules } from "@instantdb/core";
import { commandEntities, commandLinks } from "../../src/schema";
import { mergePerms, type PermsConflictCheck } from "../../src/perms";
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

// A base annotated with `InstantRules` (optional keys for every entity) is not a conflict.
const annotated: InstantRules<typeof s> = { grupos: { allow: { view: "true" } } };
export const fromAnnotated: InstantRules<typeof s> = mergePerms(annotated, [sortear]);

// An index-signature base is not a conflict either.
const indexed: Record<string, { allow: Record<string, string> }> = {};
export const fromIndexed = mergePerms(indexed, [sortear]);

// @ts-expect-error perms already defines "$rateLimits.sorteios", which belongs to a command
export const rateConflict = mergePerms({ $rateLimits: { sorteios: { limits: [] } } }, [sortear]);

// @ts-expect-error perms already defines "grupos.allow.link.sorteios", which belongs to a command
export const linkConflict = mergePerms({ grupos: { allow: { link: { sorteios: "true" } } } }, [sortear]);

// @ts-expect-error perms already defines "grupos.allow.unlink.sorteios", which belongs to a command
export const unlinkConflict = mergePerms({ grupos: { allow: { unlink: { sorteios: "true" } } } }, [sortear]);

// The messages name the exact key.
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const yes = <_T extends true>() => {};
type Msg<K extends string> = `perms already defines "${K}", which belongs to a command`;
type S = [typeof sortear];
yes<Eq<PermsConflictCheck<{ sorteios: {} }, S>, Msg<"sorteios">>>();
yes<Eq<PermsConflictCheck<{ $rateLimits: { sorteios: {} } }, S>, Msg<"$rateLimits.sorteios">>>();
yes<Eq<PermsConflictCheck<{ grupos: { allow: { link: { sorteios: "true" } } } }, S>, Msg<"grupos.allow.link.sorteios">>>();
yes<Eq<PermsConflictCheck<{ grupos: { allow: { unlink: { sorteios: "true" } } } }, S>, Msg<"grupos.allow.unlink.sorteios">>>();
yes<Eq<PermsConflictCheck<InstantRules<typeof s>, S>, S>>();

// @ts-expect-error commands repeat the entity "sorteios"
export const twice = mergePerms({}, [sortear, sortear]);
yes<Eq<PermsConflictCheck<{}, [typeof sortear, typeof sortear]>, `commands repeat the entity "sorteios"`>>();
