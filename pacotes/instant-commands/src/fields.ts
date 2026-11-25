export const COMMAND_STATUS = ["pending", "running", "done", "failed"] as const;
export type CommandStatus = (typeof COMMAND_STATUS)[number];

/** Fields every command entity gets, written by the client or the worker. */
export const STANDARD_FIELDS = ["status", "error", "result", "attempts", "createdAt", "finishedAt"] as const;

/** Names a command's own `fields` may not use. */
export const RESERVED_FIELDS = [...STANDARD_FIELDS, "id"] as const;
