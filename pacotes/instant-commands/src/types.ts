import type { DataAttrDef } from "@instantdb/core";
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
