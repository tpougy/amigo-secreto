import { describe, expect, test } from "bun:test";
import { i } from "@instantdb/core";
import { sortear } from "../testes/sortear";
import { CommandDefinitionError, defineCommand } from "./index";
import { mergePerms } from "./perms";

const base = { grupos: { allow: { view: "true", link: {}, unlink: {} } } };
const p = mergePerms(base, [sortear]);

test("create puts the rate limit first and pins pending/0", () =>
  expect(p.sorteios.allow.create).toBe(
    "rateLimit.sorteios.limit(auth.id) && (ehOrganizador && data.rodada > 0) && data.status == 'pending' && data.attempts == 0 && data.error == null && data.result == null && data.finishedAt == null",
  ));

test("update is false, delete comes from the spec", () => {
  expect(p.sorteios.allow.update).toBe("false");
  expect(p.sorteios.allow.delete).toBe("ehOrganizador");
  expect(p.sorteios.allow.view).toBe("ehOrganizador || ehMembro");
  expect(p.sorteios.bind).toEqual(sortear.bind!);
});

test("command side link only on create, unlink false", () => {
  expect(p.sorteios.allow.link.grupo).toBe(
    "actions.data == 'create' && (auth.id in linkedData.ref('organizador.id'))",
  );
  expect(p.sorteios.allow.unlink.grupo).toBe("false");
});

test("reverse side gets link/unlink true, keeping base keys", () => {
  expect(p.grupos.allow.link.sorteios).toBe("true");
  expect(p.grupos.allow.unlink.sorteios).toBe("true");
  expect(p.grupos.allow.view).toBe("true");
});

test("creates the reverse entity when the base lacks it", () => {
  const q = mergePerms({}, [sortear]) as any;
  expect(q.grupos).toEqual({ allow: { link: { sorteios: "true" }, unlink: { sorteios: "true" } } });
});

test("rate limit bucket under the entity key", () =>
  expect(p.$rateLimits.sorteios).toEqual(sortear.rateLimit!));

const simple = defineCommand({
  name: "nota",
  entity: "notas",
  fields: { titulo: i.string() },
  links: {
    notaDono: {
      forward: { on: "notas", has: "one", label: "dono" },
      reverse: { on: "donos", has: "many", label: "notas" },
    },
  },
  allow: { create: "true", view: "true" },
});

test("no rateLimit in spec: no rateLimit term and no bucket", () => {
  const q = mergePerms({}, [simple]) as any;
  expect(q.notas.allow.create).toBe("(true) && data.status == 'pending' && data.attempts == 0 && data.error == null && data.result == null && data.finishedAt == null");
  expect(q.notas.allow.delete).toBe("false");
  expect(q.$rateLimits).toBeUndefined();
});

test("allow.link absent defaults to true", () => {
  const q = mergePerms({}, [simple]) as any;
  expect(q.notas.allow.link.dono).toBe("actions.data == 'create' && (true)");
});

test("keeps base entries untouched, including entities outside the schema, without mutating", () => {
  const b = {
    $streams: { allow: { view: "false" } },
    $rateLimits: { outro: { limits: [{ capacity: 1 }] } },
    grupos: { allow: { view: "true", link: { x: "true" }, unlink: {} } },
  };
  const snapshot = structuredClone(b);
  const q = mergePerms(b, [sortear]) as any;
  expect(b).toEqual(snapshot);
  expect(q.$streams).toEqual(b.$streams);
  expect(q.$rateLimits.outro).toEqual(b.$rateLimits.outro);
  expect(q.$rateLimits.sorteios).toEqual(sortear.rateLimit);
  expect(q.grupos.allow.link).toEqual({ x: "true", sorteios: "true" });
});

describe("conflicts", () => {
  test("base defines the command entity", () =>
    expect(() => mergePerms({ sorteios: { allow: { view: "true" } } } as any, [sortear] as any)).toThrow(
      CommandDefinitionError,
    ));
  test("base defines the rate limit bucket", () =>
    expect(() => mergePerms({ $rateLimits: { sorteios: { limits: [] } } } as any, [sortear] as any)).toThrow(
      CommandDefinitionError,
    ));
  test("base defines the generated link rule", () =>
    expect(() =>
      mergePerms({ grupos: { allow: { link: { sorteios: "true" } } } } as any, [sortear] as any),
    ).toThrow(CommandDefinitionError));
  test("base defines the generated unlink rule", () =>
    expect(() =>
      mergePerms({ grupos: { allow: { unlink: { sorteios: "true" } } } } as any, [sortear] as any),
    ).toThrow(CommandDefinitionError));
});

describe("a command whose link points at another command's entity", () => {
  const owner = defineCommand({ name: "owner", entity: "owners", fields: {}, allow: { create: "true", view: "true" } });
  const pointer = defineCommand({
    name: "pointer",
    entity: "pointers",
    fields: {},
    links: {
      pointerOwner: {
        forward: { on: "pointers", has: "one", label: "owner" },
        reverse: { on: "owners", has: "many", label: "pointers" },
      },
    },
    allow: { create: "true", view: "true" },
  });

  for (const [label, list] of [
    ["linking command first", [pointer, owner]],
    ["linked command first", [owner, pointer]],
  ] as const) {
    test(label, () => {
      const q = mergePerms({}, list as any) as any;
      expect(q.owners.allow.create).toBe("(true) && data.status == 'pending' && data.attempts == 0 && data.error == null && data.result == null && data.finishedAt == null");
      expect(q.owners.allow.update).toBe("false");
      expect(q.owners.allow.link).toEqual({ pointers: "true" });
      expect(q.owners.allow.unlink).toEqual({ pointers: "true" });
      expect(q.pointers.allow.link.owner).toBe("actions.data == 'create' && (true)");
    });
  }
});

test("the same command twice is reported as a repeated command", () => {
  expect(() => mergePerms({}, [sortear, sortear] as any)).toThrow(/"sorteios" is used by more than one command/);
});
