import { i, type DataAttrDef, type EntityDef } from "@instantdb/core";
import type { Command, LinkSpec } from "./command";
import { CommandDefinitionError } from "./errors";
import type { CommandStatus } from "./fields";
import type { FieldsOf, ResultOf } from "./types";

type Prettify<T> = { [K in keyof T]: T[K] } & {};

type StandardAttrs<C extends Command> = {
  status: DataAttrDef<CommandStatus, true, true>;
  error: DataAttrDef<string, false, false>;
  result: DataAttrDef<ResultOf<C>, false, false>;
  attempts: DataAttrDef<number, true, false>;
  createdAt: DataAttrDef<string | number | Date, true, false>;
  finishedAt: DataAttrDef<string | number | Date, false, false>;
};

type EntityOf<C> = C extends { entity: infer E extends string } ? E : never;

type Repeated<Cs extends readonly Command[], K extends "name" | "entity"> = {
  [I in keyof Cs]: Cs[I][K] extends infer V
    ? { [J in keyof Cs]: J extends I ? never : Cs[J][K] extends V ? (V extends Cs[J][K] ? V : never) : never }[number]
    : never;
}[number];

/** `Cs` when names and entities are unique; otherwise a readable sentence that fails the call. */
export type UniqueCommands<Cs extends readonly Command[]> = [Repeated<Cs, "entity">] extends [never]
  ? [Repeated<Cs, "name">] extends [never]
    ? Cs
    : `commands repeat the name "${Extract<Repeated<Cs, "name">, string>}"`
  : `commands repeat the entity "${Extract<Repeated<Cs, "entity">, string>}"`;

type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

export type LinksFrom<Cs extends readonly Command[]> = Prettify<
  UnionToIntersection<Cs[number] extends infer C ? (C extends { links: infer L } ? L : {}) : never>
>;

type AttrsOf<C extends Command> = StandardAttrs<C> &
  (FieldsOf<C> extends infer F extends Record<string, DataAttrDef<any, any, any, any>> ? F : {});

export type EntitiesOf<Cs extends readonly Command[]> = {
  [C in Cs[number] as EntityOf<C>]: EntityDef<AttrsOf<C>, {}, void>;
};

function standardAttrs(): Record<string, DataAttrDef<any, any, any, any>> {
  return {
    status: i.string().indexed(),
    error: i.string().optional(),
    result: i.json().optional(),
    attempts: i.number(),
    createdAt: i.date(),
    finishedAt: i.date().optional(),
  };
}

/** Throws `CommandDefinitionError` when two commands share an entity or a name. */
export function assertUnique(commands: readonly Command[]): void {
  const problems: string[] = [];
  for (const key of ["entity", "name"] as const) {
    const seen = new Set<string>();
    for (const c of commands) {
      if (seen.has(c[key])) problems.push(`${key} "${c[key]}" is used by more than one command`);
      seen.add(c[key]);
    }
  }
  if (problems.length > 0) throw new CommandDefinitionError("commands", problems);
}

/** Generates one Instant entity per command: the standard attrs plus the command's own `fields`. */
export function commandEntities<const Cs extends readonly Command[]>(
  commands: Cs & UniqueCommands<Cs>,
): EntitiesOf<Cs> {
  const list = commands as unknown as readonly Command[];
  assertUnique(list);
  const out: Record<string, unknown> = {};
  for (const c of list) out[c.entity] = i.entity({ ...standardAttrs(), ...(c.fields ?? {}) });
  return out as EntitiesOf<Cs>;
}

/** Returns each command's declared `links`, merged. */
export function commandLinks<const Cs extends readonly Command[]>(commands: Cs): LinksFrom<Cs> {
  const out: Record<string, LinkSpec> = {};
  for (const c of commands) Object.assign(out, c.links ?? {});
  return out as LinksFrom<Cs>;
}
