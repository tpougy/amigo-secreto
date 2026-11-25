import type { Command } from "./command";
import { CommandDefinitionError } from "./errors";

type Prettify<T> = { [K in keyof T]: T[K] } & {};
type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

type LinksOfCommand<C> = C extends { links: infer L extends Record<string, { forward: { label: string } }> } ? L : {};
type LabelOf<L> = L extends { forward: { label: infer F extends string } } ? F : never;
type ReverseOf<L> = L extends { reverse: { on: infer O extends string; label: infer R extends string } }
  ? { on: O; label: R }
  : never;

type CommandSide<C> = C extends { entity: infer E extends string }
  ? {
      [K in E]: {
        bind?: Record<string, string>;
        allow: {
          create: string;
          view: string;
          update: "false";
          delete: string;
          link: { [L in LabelOf<LinksOfCommand<C>[keyof LinksOfCommand<C>]>]: string };
          unlink: { [L in LabelOf<LinksOfCommand<C>[keyof LinksOfCommand<C>]>]: "false" };
        };
      };
    }
  : never;

type ReverseSide<C> = ReverseOf<LinksOfCommand<C>[keyof LinksOfCommand<C>]> extends infer R
  ? R extends { on: infer O extends string; label: infer L extends string }
    ? { [K in O]: { allow: { link: { [X in L]: "true" }; unlink: { [X in L]: "true" } } } }
    : never
  : never;

type RateLimited<C> = C extends { entity: infer E extends string; rateLimit: infer R } ? { [K in E]: R } : never;

/** What `mergePerms` adds to the base for the given commands. */
export type GeneratedPerms<Cs extends readonly Command[]> = Prettify<
  UnionToIntersection<CommandSide<Cs[number]>> &
    UnionToIntersection<ReverseSide<Cs[number]>> &
    ([RateLimited<Cs[number]>] extends [never]
      ? {}
      : { $rateLimits: Prettify<UnionToIntersection<RateLimited<Cs[number]>>> })
>;

type Has<T, K extends string> = T extends Record<string, unknown> ? (K extends keyof T ? true : false) : false;
type Sub<T, K extends string> = T extends Record<string, unknown> ? (K extends keyof T ? T[K] : undefined) : undefined;

type ConflictOf<B, C> = C extends { entity: infer E extends string; rateLimit: object }
  ? Has<B, E> extends true
    ? E
    : Has<Sub<B, "$rateLimits">, E> extends true
      ? `$rateLimits.${E}`
      : ReverseConflict<B, C>
  : C extends { entity: infer E extends string }
    ? Has<B, E> extends true
      ? E
      : ReverseConflict<B, C>
    : never;

type ReverseConflict<B, C> = C extends { links: infer L extends Record<string, unknown> }
  ? {
      [K in keyof L]: L[K] extends { reverse: { on: infer O extends string; label: infer R extends string } }
        ? Has<Sub<Sub<Sub<B, O>, "allow">, "link">, R> extends true
          ? `${O}.allow.link.${R}`
          : Has<Sub<Sub<Sub<B, O>, "allow">, "unlink">, R> extends true
            ? `${O}.allow.unlink.${R}`
            : never
        : never;
    }[keyof L]
  : never;

type ConflictKey<B, Cs extends readonly Command[]> = ConflictOf<B, Cs[number]>;

/** `Cs` when the base has no conflict; otherwise a readable sentence that fails the call. */
export type PermsConflictCheck<B, Cs extends readonly Command[]> = [ConflictKey<B, Cs>] extends [never]
  ? Cs
  : `perms already defines "${Extract<ConflictKey<B, Cs>, string>}", which belongs to a command`;

type Rules = Record<string, any>;

function isObject(v: unknown): v is Rules {
  return typeof v === "object" && v !== null;
}

/** Returns `base` plus the rules each command needs. Does not mutate `base`; throws on any clash. */
export function mergePerms<const B extends Record<string, unknown>, const Cs extends readonly Command[]>(
  base: B,
  commands: Cs & PermsConflictCheck<B, Cs>,
): B & GeneratedPerms<Cs> {
  const list = commands as unknown as readonly Command[];
  const out: Rules = { ...base };
  const rateLimits: Rules = isObject(base.$rateLimits) ? { ...base.$rateLimits } : {};
  let addedRateLimit = false;
  const problems: string[] = [];

  // Copy-on-write for each base entity we touch, so the caller's object stays intact.
  const reverseEntity = (name: string): Rules => {
    const prev = isObject(out[name]) ? out[name] : {};
    const allow = isObject(prev.allow) ? prev.allow : {};
    const next = {
      ...prev,
      allow: {
        ...allow,
        link: { ...(isObject(allow.link) ? allow.link : {}) },
        unlink: { ...(isObject(allow.unlink) ? allow.unlink : {}) },
      },
    };
    out[name] = next;
    return next.allow;
  };

  for (const c of list) {
    if (c.entity in base) {
      problems.push(`perms already defines "${c.entity}", which belongs to command "${c.name}"`);
      continue;
    }
    if (c.rateLimit && c.entity in rateLimits) {
      problems.push(`perms already defines "$rateLimits.${c.entity}", which belongs to command "${c.name}"`);
      continue;
    }

    const link: Record<string, string> = {};
    const unlink: Record<string, string> = {};
    for (const l of Object.values(c.links ?? {})) {
      link[l.forward.label] = `actions.data == 'create' && (${c.allow.link?.[l.forward.label] ?? "true"})`;
      unlink[l.forward.label] = "false";

      const allow = reverseEntity(l.reverse.on);
      for (const [side, map] of [["link", allow.link], ["unlink", allow.unlink]] as const) {
        if (l.reverse.label in map) {
          problems.push(
            `perms already defines "${l.reverse.on}.allow.${side}.${l.reverse.label}", which belongs to command "${c.name}"`,
          );
        }
        map[l.reverse.label] = "true";
      }
    }

    const rate = c.rateLimit ? `rateLimit.${c.entity}.limit(auth.id) && ` : "";
    out[c.entity] = {
      ...(c.bind ? { bind: c.bind } : {}),
      allow: {
        create: `${rate}(${c.allow.create}) && data.status == 'pending' && data.attempts == 0`,
        view: c.allow.view,
        update: "false",
        delete: c.allow.delete ?? "false",
        link,
        unlink,
      },
    };
    if (c.rateLimit) {
      rateLimits[c.entity] = c.rateLimit;
      addedRateLimit = true;
    }
  }

  if (problems.length > 0) throw new CommandDefinitionError("mergePerms", problems);
  if (addedRateLimit) out.$rateLimits = rateLimits;
  return out as B & GeneratedPerms<Cs>;
}
