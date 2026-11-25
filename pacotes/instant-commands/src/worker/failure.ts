/** Thrown by `fail()`: ends the command as `failed` with this message, without retries. */
export class CommandFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandFailure";
  }
}

/**
 * Fails the command with `message`, which is stored in `error` and shown to the client.
 * A module-level function with a declared `never` return, so it narrows control flow.
 */
export function fail(message: string): never {
  throw new CommandFailure(message);
}
