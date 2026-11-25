import { expect, test } from "bun:test";
import { i } from "@instantdb/core";
import { checkExpressions } from "./cel";
import type { CommandSpec } from "./command";

const spec = (over: Partial<CommandSpec> & { allow?: CommandSpec["allow"] } = {}): CommandSpec => ({
  name: "x",
  entity: "sorteios",
  fields: { rodada: i.number() },
  links: {
    sorteioGrupo: {
      forward: { on: "sorteios", has: "one", label: "grupo" },
      reverse: { on: "grupos", has: "many", label: "sorteios" },
    },
  },
  allow: { create: "true", view: "true" },
  ...over,
});

test("flags identifiers in allow missing from bind", () => {
  expect(checkExpressions(spec({ allow: { create: "ehDono", view: "true" } }))).toEqual([
    expect.stringMatching(/ehDono/),
  ]);
});

test("accepts bind aliases", () => {
  expect(checkExpressions(spec({ bind: { ehDono: "true" }, allow: { create: "ehDono", view: "true" } }))).toEqual([]);
});

test("accepts CEL vocabulary", () => {
  const e =
    "auth.id != null && data.rodada > 0 && newData.rodada in [1] && linkedData.x == request.y && " +
    "ruleParams.a == actions.b && rateLimit.sorteios.limit(auth.id) && size(data.ref('grupo.x')) > 0 && has(data.rodada) && true && !false";
  expect(checkExpressions(spec({ allow: { create: e, view: "true" } }))).toEqual([]);
});

test("flags data.ref whose first segment is not a link label or field", () => {
  const p = checkExpressions(spec({ bind: { a: "auth.id in data.ref('group.x')" } }));
  expect(p).toEqual([expect.stringMatching(/group/)]);
});

test("accepts data.ref on fields and standard fields", () => {
  expect(checkExpressions(spec({ bind: { a: "data.ref('rodada') && data.ref('status')" } }))).toEqual([]);
});

test("ignores identifiers inside string literals", () => {
  const e = `!('pending' in data.ref('grupo.reaberturas.status')) && "foo bar" != ''`;
  expect(checkExpressions(spec({ allow: { create: e, view: "true" } }))).toEqual([]);
});
