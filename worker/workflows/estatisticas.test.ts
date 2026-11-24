// `contarGrupos` contra o app de TESTE, com um registro próprio (não o ESTATISTICAS_ID).
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { id } from "@instantdb/admin";
import { adminTeste, criarGrupoTeste, criarUsuario, limparTudo, novoPrefixo, type Usuario } from "@amigo/instant/teste";
import { contarGrupos } from "./estatisticas";

setDefaultTimeout(30_000);

const PREFIXO = novoPrefixo("estat");
const admin = adminTeste();
const registro = id();
let org: Usuario;

beforeAll(async () => {
  org = await criarUsuario(PREFIXO);
});

afterAll(async () => {
  await admin.transact(admin.tx.estatisticas[registro]!.delete());
  await limparTudo(PREFIXO);
});

test("conta os existentes, soma os novos, ignora e2e- e não diminui com grupo apagado", async () => {
  const inicial = await contarGrupos(admin, registro);

  const g = await criarGrupoTeste(org, { titulo: `${PREFIXO} contado` });
  await criarGrupoTeste(org, { titulo: `e2e-${PREFIXO} ignorado` });
  const depois = await contarGrupos(admin, registro);
  expect(depois.gruposOrganizados).toBe(inicial.gruposOrganizados + 1);

  await admin.transact(admin.tx.grupos[g.grupoId]!.delete());
  const aposApagar = await contarGrupos(admin, registro);
  expect(aposApagar.gruposOrganizados).toBe(depois.gruposOrganizados);

  const { estatisticas } = await admin.query({ estatisticas: { $: { where: { id: registro } } } });
  expect(estatisticas[0]?.gruposOrganizados).toBe(aposApagar.gruposOrganizados);
});
