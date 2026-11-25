// Rules of the test app: the base rules for `grupos` plus the ones generated for the commands.
import type { InstantRules } from "@instantdb/core";
import { mergePerms } from "../../src/perms";
import { reabrir, sortear } from "./commands";
import type { TestSchema } from "./schema";

const base = {
  attrs: { allow: { create: "false" } },
  grupos: {
    bind: { ehOrganizador: "auth.id in data.ref('organizador.id')" },
    allow: {
      view: "true",
      create: "false",
      update: "false",
      delete: "ehOrganizador",
      link: {},
      unlink: {},
    },
  },
} satisfies InstantRules<TestSchema>;

const rules = mergePerms(base, [sortear, reabrir]);

export default rules;
