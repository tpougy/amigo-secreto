import type { Jsonify } from "../../src/types";
import type { Step } from "../../src/worker/step";

type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const yes = <_T extends true>() => {};

declare const step: Step;

async function _uses() {
  const build = (n: number, label: string) => ({ quando: new Date(), n, label, skip: undefined, fn: () => 1 });

  const r = await step.run("build", build, 1, "x");
  yes<Eq<typeof r.quando, string>>();
  yes<Eq<typeof r, { quando: string; n: number; label: string }>>();

  await step.run({ name: "build", retryPolicy: { maximumAttempts: 2, initialInterval: "10ms" } }, build, 1, "x");

  // @ts-expect-error wrong argument type
  await step.run("build", build, "1", "x");

  // @ts-expect-error missing argument
  await step.run("build", build, 1);

  // @ts-expect-error not a DurationString
  await step.run({ name: "build", retryPolicy: { initialInterval: "soon" } }, build, 1, "x");
}

yes<Eq<Jsonify<Date>, string>>();
yes<Eq<Jsonify<{ a: Date[]; b?: number; c: undefined }>, { a: string[]; b?: number }>>();
yes<Eq<Jsonify<[Date, number]>, [string, number]>>();
yes<Eq<Jsonify<string | null>, string | null>>();
yes<Eq<Jsonify<void>, null>>();
yes<Eq<Jsonify<undefined>, null>>();
yes<Eq<Jsonify<{ a: void; b: number }>, { b: number }>>();
