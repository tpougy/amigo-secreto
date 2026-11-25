import type { Command } from "./command";
export const COMMAND_STATUS = ["pending", "running", "done", "failed"] as const;
export type CommandStatus = (typeof COMMAND_STATUS)[number];

/** Fields every command entity gets, written by the client or the worker. */
export const STANDARD_FIELDS = ["status", "error", "result", "attempts", "createdAt", "finishedAt"] as const;

/** Names a command's own `fields` may not use. */
export const RESERVED_FIELDS = [...STANDARD_FIELDS, "id"] as const;

function matchesType(valueType: string, v: unknown): boolean {
  switch (valueType) {
    case "string":
      return typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "boolean":
      return typeof v === "boolean";
    case "date":
      return (
        (v instanceof Date && !Number.isNaN(v.getTime())) ||
        (typeof v === "number" && Number.isFinite(v)) ||
        (typeof v === "string" && !Number.isNaN(Date.parse(v)))
      );
    case "json":
      return v !== undefined;
    default:
      return true;
  }
}

/** Checks values against each field's `valueType`/`required` (and, in client mode, link ids). Returns the problems. */
export function validateInput(command: Command, values: Record<string, unknown>, mode: "client" | "worker"): string[] {
  const problems: string[] = [];
  for (const [name, def] of Object.entries(command.fields ?? {})) {
    const v = values[name];
    if (v === undefined || v === null) {
      if (def.required) problems.push(`${name}: required`);
    } else if (!matchesType(def.valueType, v)) {
      problems.push(`${name}: expected ${def.valueType}`);
    }
  }
  if (mode === "client") {
    for (const link of Object.values(command.links ?? {})) {
      const label = link.forward.label;
      const v = values[label];
      if (typeof v !== "string" || v === "") problems.push(`${label}: link id must be a non-empty string`);
    }
  }
  return problems;
}
