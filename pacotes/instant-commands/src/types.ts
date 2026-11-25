import type { DataAttrDef } from "@instantdb/core";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Command } from "./command";
import type { CommandStatus } from "./fields";

type Prettify<T> = { [K in keyof T]: T[K] } & {};

type ValueOf<A> = A extends DataAttrDef<infer V, any, any, any> ? V : never;

type RequiredKeys<F> = { [K in keyof F]: F[K] extends DataAttrDef<any, true, any, any> ? K : never }[keyof F];
type OptionalKeys<F> = Exclude<keyof F, RequiredKeys<F>>;

export type FieldsOf<C> = C extends { fields: infer F } ? F : {};
export type LinksOf<C> = C extends { links: infer L } ? L : {};

type LinkLabels<L> = { [K in keyof L]: L[K] extends { forward: { label: infer N extends string } } ? N : never }[keyof L];

/** Input of a command: required fields, optional fields as optional keys, and each forward label as a string id. */
export type InputOf<C extends Command> = Prettify<
  { [K in RequiredKeys<FieldsOf<C>>]: ValueOf<FieldsOf<C>[K]> } & {
    [K in OptionalKeys<FieldsOf<C>>]?: ValueOf<FieldsOf<C>[K]> | undefined;
  } & { [N in LinkLabels<LinksOf<C>>]: string }
>;

type ResultSpecOf<C> = C extends { result: infer R } ? R : never;

type OutputOfSpec<R, K extends "input" | "output"> = [R] extends [never]
  ? null
  : R extends DataAttrDef<infer V, any, any, any>
    ? V
    : R extends StandardSchemaV1
      ? StandardSchemaV1.InferOutput<R> extends infer O
        ? K extends "output"
          ? O
          : StandardSchemaV1.InferInput<R>
        : never
      : null;

/** What the client receives: `T` of `i.json<T>()`, the Standard Schema output, or `null` without `result`. */
export type ResultOf<C extends Command> = OutputOfSpec<ResultSpecOf<C>, "output">;

/** What `complete` accepts: `T` of `i.json<T>()`, the Standard Schema input, or `null` without `result`. */
export type ResultInputOf<C extends Command> = OutputOfSpec<ResultSpecOf<C>, "input">;

/** Values of a command's own fields as stored: required ones as is, optional ones as optional keys. */
export type FieldValues<C extends Command> = Prettify<
  { [K in RequiredKeys<FieldsOf<C>>]: ValueOf<FieldsOf<C>[K]> } & {
    [K in OptionalKeys<FieldsOf<C>>]?: ValueOf<FieldsOf<C>[K]> | undefined;
  }
>;

/** Id of a command of type `C`; branded so it cannot be used with another command. */
export type CommandId<C extends Command> = string & { readonly __command: C["name"] };

/** What a client sees of a command; `null` means the command no longer exists (or is not visible). */
export type CommandState<C extends Command> = {
  id: CommandId<C>;
  status: CommandStatus;
  error: string | null;
  /** The validated result; `null` while there is none, or when the stored value failed validation (see `resultIssues`). */
  result: ResultOf<C> | null;
  resultIssues: readonly { message: string }[] | null;
  attempts: number;
  createdAt: number;
  finishedAt: number | null;
} | null;

/**
 * How a value looks after a JSON round trip: `Date` → `string`, arrays and objects recursively,
 * `undefined` and function properties omitted.
 */
export type Jsonify<T> = 0 extends 1 & T
  ? any
  : [T] extends [void | undefined]
    ? null
    : JsonifyValue<T>;

// Nested `void`/`undefined` properties are omitted by JSON.stringify; only the top level becomes `null`.
type JsonifyValue<T> = 0 extends 1 & T
  ? any
  : unknown extends T
    ? unknown
    : T extends Date
      ? string
      : T extends string | number | boolean | null
        ? T
        : T extends void | undefined | symbol | ((...args: any[]) => any)
          ? never
          : T extends { toJSON(): infer J }
            ? JsonifyValue<J>
            : T extends readonly unknown[]
              ? { -readonly [K in keyof T]: JsonifyValue<T[K]> }
              : T extends object
                ? { [K in keyof T as [JsonifyValue<T[K]>] extends [never] ? never : K]: JsonifyValue<T[K]> }
                : never;
