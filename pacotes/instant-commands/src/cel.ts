import { STANDARD_FIELDS } from "./fields";
import type { CommandSpec } from "./command";

const CEL_WORDS = new Set([
  // Instant's CEL variables
  "auth", "data", "newData", "linkedData", "ruleParams", "request", "actions", "rateLimit",
  // literals and operators
  "true", "false", "null", "in",
  // functions and macros
  "size", "has", "exists", "all", "map", "filter", "matches", "startsWith", "endsWith", "contains",
  "int", "string", "double", "bool", "timestamp", "duration",
]);

function stripStrings(expr: string): string {
  return expr.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "''");
}

function unknownIdentifiers(expr: string, bind: Set<string>): string[] {
  const found = stripStrings(expr).match(/(?<![.\w])[A-Za-z_]\w*/g) ?? [];
  return [...new Set(found)].filter((id) => !CEL_WORDS.has(id) && !bind.has(id));
}

/**
 * Pattern-based checks (not a CEL parser): identifiers in `allow` must be CEL words or `bind` aliases,
 * and the first segment of each `data.ref('...')` in `bind` and `allow` must be a link label or a field.
 */
export function checkExpressions(spec: CommandSpec): string[] {
  const problems: string[] = [];
  const bindNames = new Set(Object.keys(spec.bind ?? {}));
  const refRoots = new Set<string>([
    ...Object.values(spec.links ?? {}).map((l) => l.forward.label),
    ...Object.keys(spec.fields ?? {}),
    ...STANDARD_FIELDS,
  ]);

  const allowExprs: [string, string][] = [
    ["allow.create", spec.allow.create],
    ["allow.view", spec.allow.view],
    ...(spec.allow.delete !== undefined ? [["allow.delete", spec.allow.delete] as [string, string]] : []),
    ...Object.entries(spec.allow.link ?? {}).map(([k, v]) => [`allow.link.${k}`, v] as [string, string]),
  ];
  for (const [where, expr] of allowExprs) {
    for (const id of unknownIdentifiers(expr, bindNames)) {
      problems.push(`${where} uses "${id}", which is neither a CEL word nor a bind alias`);
    }
  }

  const refExprs: [string, string][] = [
    ...Object.entries(spec.bind ?? {}).map(([k, v]) => [`bind.${k}`, v] as [string, string]),
    ...allowExprs.filter(([where]) => !where.startsWith("allow.link.")),
  ];
  for (const [where, expr] of refExprs) {
    for (const m of expr.matchAll(/(?<![\w.])data\.ref\(\s*(['"])([^'".]+)/g)) {
      const root = m[2]!;
      if (!refRoots.has(root)) {
        problems.push(`${where} has data.ref('${root}...'), but "${root}" is not a link label or a field`);
      }
    }
  }
  return problems;
}
