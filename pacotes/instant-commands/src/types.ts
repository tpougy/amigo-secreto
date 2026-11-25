import type { DataAttrDef } from "@instantdb/core";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Command } from "./command";

type Prettify<T> = { [K in keyof T]: T[K] } & {};

type ValueOf<A> = A extends DataAttrDef<infer V, any, any, any> ? V : never;

type RequiredKeys<F> = { [K in keyof F]: F[K] extends DataAttrDef<any, true, any, any> ? K : never }[keyof F];
type OptionalKeys<F> = Exclude<keyof F, RequiredKeys<F>>;

type FieldsOf<C> = C extends { fields: infer F } ? F : {};
type LinksOf<C> = C extends { links: infer L } ? L : {};

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
