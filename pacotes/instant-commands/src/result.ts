import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Command } from "./command";
import { CommandDefinitionError } from "./errors";
import type { ResultOf } from "./types";

export function isStandardSchema(x: unknown): x is StandardSchemaV1 {
  return (
    (typeof x === "object" || typeof x === "function") &&
    x !== null &&
    "~standard" in x &&
    typeof (x as { "~standard": unknown })["~standard"] === "object" &&
    (x as { "~standard": object })["~standard"] !== null &&
    typeof (x as { "~standard": { validate?: unknown } })["~standard"].validate === "function"
  );
}

export type ResultIssue = { message: string; path?: readonly unknown[] };

/** Validates synchronously against the command's Standard Schema; `i.json<T>()` and no `result` pass unchecked. */
export function validateResult<C extends Command>(
  command: C,
  value: unknown,
): { ok: true; value: ResultOf<C> } | { ok: false; issues: readonly ResultIssue[] } {
  const spec = command.result;
  if (!isStandardSchema(spec)) return { ok: true, value: value as ResultOf<C> };
  const out = spec["~standard"].validate(value);
  if (out instanceof Promise) {
    throw new CommandDefinitionError(command.name, ["result schema must validate synchronously"]);
  }
  if (out.issues) {
    return {
      ok: false,
      issues: out.issues.map((x) => ({
        message: x.message,
        path: x.path?.map((p) => (typeof p === "object" && p !== null ? p.key : p)),
      })),
    };
  }
  return { ok: true, value: out.value as ResultOf<C> };
}
