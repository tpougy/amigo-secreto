import type { DataAttrDef } from "@instantdb/core";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { checkExpressions } from "./cel";
import { CommandDefinitionError } from "./errors";
import { RESERVED_FIELDS } from "./fields";

declare const COMMAND_BRAND: unique symbol;
export type { COMMAND_BRAND };

export type LinkSpec = {
  forward: { on: string; has: "one"; label: string; onDelete?: "cascade" };
  reverse: { on: string; has: "many"; label: string };
};

export type ResultSpec = DataAttrDef<any, any, any, any> | StandardSchemaV1;

export type CommandSpec = {
  name: string;
  entity: string;
  fields?: Record<string, DataAttrDef<any, any, any, any>>;
  links?: Record<string, LinkSpec>;
  bind?: Record<string, string>;
  allow: { create: string; view: string; delete?: string; link?: Record<string, string> };
  rateLimit?: {
    limits: { capacity: number; refill?: { amount?: number; period?: string; type?: "interval" | "greedy" } }[];
  };
  result?: ResultSpec;
};

export type Command<S extends CommandSpec = CommandSpec> = S & { readonly [COMMAND_BRAND]: true };

function validate(spec: CommandSpec): string[] {
  const problems: string[] = [];
  const links = Object.entries(spec.links ?? {});

  for (const [key, link] of links) {
    if (link.forward.on !== spec.entity) {
      problems.push(`links.${key}: forward.on is "${link.forward.on}" but must equal the entity "${spec.entity}"`);
    }
    if (link.forward.has !== "one") {
      problems.push(`links.${key}: forward.has must be "one", got "${String(link.forward.has)}"`);
    }
  }

  for (const name of Object.keys(spec.fields ?? {})) {
    if ((RESERVED_FIELDS as readonly string[]).includes(name)) {
      problems.push(`fields.${name}: "${name}" is a reserved field name`);
    }
  }

  for (const key of ["update", "unlink"]) {
    if (key in spec.allow) problems.push(`allow.${key} is not allowed: it is always "false"`);
  }

  const labels = new Set(links.map(([, l]) => l.forward.label));
  for (const key of Object.keys(spec.allow.link ?? {})) {
    if (!labels.has(key)) problems.push(`allow.link.${key} is not the forward.label of any declared link`);
  }

  if (links.some(([, l]) => l.forward.onDelete === "cascade") && spec.allow.delete === undefined) {
    problems.push(`allow.delete is required when a link has onDelete: "cascade"`);
  }

  problems.push(...checkExpressions(spec));
  return problems;
}

/** Declares a command. Returns plain data (no side effects); throws with every problem at once. */
export function defineCommand<const S extends CommandSpec>(spec: S): Command<S> {
  const problems = validate(spec);
  if (problems.length > 0) throw new CommandDefinitionError(spec.name, problems);
  return spec as Command<S>;
}
