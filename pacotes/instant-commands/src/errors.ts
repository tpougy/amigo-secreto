export class CommandDefinitionError extends Error {
  readonly problems: string[];
  constructor(commandName: string, problems: string[]) {
    super(`Invalid command "${commandName}":\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "CommandDefinitionError";
    this.problems = problems;
  }
}
