// Contador público (`estatisticas`): leitura liberada, escrita só pelo admin. App de TESTE.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { id } from "@instantdb/admin";
import { adminTeste, criarUsuario, limparTudo, novoPrefixo, type Usuario } from "./instant-teste";

setDefaultTimeout(30_000);

const PREFIXO = novoPrefixo("perm-estat");
const admin = adminTeste();
const registro = id(); // id próprio do teste (o real é ESTATISTICAS_ID)
let u: Usuario;

beforeAll(async () => {
  u = await criarUsuario(PREFIXO);
  await admin.transact(
    admin.tx.estatisticas[registro]!.update({ gruposOrganizados: 7, contadoAte: Date.now(), atualizadoEm: Date.now() }),
  );
});

afterAll(async () => {
  await admin.transact(admin.tx.estatisticas[registro]!.delete());
  await limparTudo(PREFIXO);
});

test("visitante sem login e usuário logado leem o contador", async () => {
  const consulta = { estatisticas: { $: { where: { id: registro } } } };
  const visitante = await admin.asUser({ guest: true }).query(consulta);
  expect(visitante.estatisticas[0]?.gruposOrganizados).toBe(7);
  const logado = await u.db.query(consulta);
  expect(logado.estatisticas[0]?.gruposOrganizados).toBe(7);
});

test("ninguém além do admin cria, altera ou apaga", async () => {
  await expect(u.db.transact(u.db.tx.estatisticas[registro]!.update({ gruposOrganizados: 999 }))).rejects.toThrow();
  await expect(u.db.transact(u.db.tx.estatisticas[registro]!.delete())).rejects.toThrow();
  await expect(
    u.db.transact(u.db.tx.estatisticas[id()]!.create({ gruposOrganizados: 1, contadoAte: 0, atualizadoEm: 0 })),
  ).rejects.toThrow();
  await expect(
    admin.asUser({ guest: true }).transact(admin.tx.estatisticas[registro]!.update({ gruposOrganizados: 0 })),
  ).rejects.toThrow();
  const { estatisticas } = await admin.query({ estatisticas: { $: { where: { id: registro } } } });
  expect(estatisticas[0]?.gruposOrganizados).toBe(7);
});
