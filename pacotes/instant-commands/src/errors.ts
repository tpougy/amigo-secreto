export class CommandDefinitionError extends Error {
  readonly problems: string[];
  constructor(commandName: string, problems: string[]) {
    super(`Invalid command "${commandName}":\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "CommandDefinitionError";
    this.problems = problems;
  }
}

export class CommandResultError extends Error {
  readonly issues: readonly { message: string; path?: readonly unknown[] }[];
  constructor(issues: readonly { message: string; path?: readonly unknown[] }[]) {
    super(`Invalid command result:\n${issues.map((p) => `  - ${p.message}`).join("\n")}`);
    this.name = "CommandResultError";
    this.issues = issues;
  }
}

export class CommandInputError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid command input:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "CommandInputError";
    this.problems = problems;
  }
}
