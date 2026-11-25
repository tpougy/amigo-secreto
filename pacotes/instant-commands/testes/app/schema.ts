// Schema of the test app (`instant-commands-teste`). Applied with testes/push-app-teste.sh.
import { i } from "@instantdb/core";
import { commandEntities, commandLinks } from "../../src/schema";
import { reabrir, sortear } from "./commands";

const commands = [sortear, reabrir] as const;

const _schema = i.schema({
  entities: {
    $files: i.entity({
      path: i.string().unique().indexed(),
      url: i.string(),
    }),
    $users: i.entity({
      email: i.string().unique().indexed().optional(),
    }),
    grupos: i.entity({ titulo: i.string(), status: i.string() }),
    ...commandEntities(commands),
  },
  links: {
    grupoOrganizador: {
      forward: { on: "grupos", has: "one", label: "organizador" },
      reverse: { on: "$users", has: "many", label: "gruposOrganizados" },
    },
    ...commandLinks(commands),
  },
});

type _TestSchema = typeof _schema;
interface TestSchema extends _TestSchema {}
const schema: TestSchema = _schema;

export type { TestSchema };
export default schema;
