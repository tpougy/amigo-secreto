// Perfis visíveis: com `grupos.perfisVisiveis` ligado, membros e organizador veem as respostas
// uns dos outros. Roda contra o app de TESTE. Ver pacotes/instant/perms.ts (respostas.view).
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { id } from "@instantdb/admin";
import { criarGrupoTeste, criarUsuario, entrar, limparTudo, novoPrefixo, type Usuario } from "./instant-teste";

setDefaultTimeout(30_000);

const PREFIXO = novoPrefixo("perm-perfis");

let org: Usuario;
let a: Usuario;
let b: Usuario;
let estranho: Usuario;
let orgH: Usuario;
let membroH: Usuario;
let G: { grupoId: string; codigo: string };
let pA: string;
let pB: string;
let respostaB: string;

const respostasDeB = async (u: Usuario, ruleParams?: Record<string, string>) => {
  const r = await u.db.query(
    { participantes: { $: { where: { id: pB } }, respostas: {} }, respostas: {} },
    ruleParams ? { ruleParams } : undefined,
  );
  const viaParticipante = r.participantes[0]?.respostas.map((x) => x.id) ?? [];
  const diretas = r.respostas.filter((x) => x.id === respostaB).map((x) => x.id);
  return { viaParticipante, diretas };
};

const ligar = (v: boolean) => org.db.transact(org.db.tx.grupos[G.grupoId]!.update({ perfisVisiveis: v }));

beforeAll(async () => {
  [org, a, b, estranho, orgH, membroH] = await Promise.all(
    Array.from({ length: 6 }, () => criarUsuario(PREFIXO)),
  );
  G = await criarGrupoTeste(org);
  const H = await criarGrupoTeste(orgH);
  await entrar(org, G.grupoId, G.codigo);
  pA = await entrar(a, G.grupoId, G.codigo);
  pB = await entrar(b, G.grupoId, G.codigo);
  await entrar(membroH, H.grupoId, H.codigo);
  const r = await b.db.query({ campos: { $: { where: { "grupo.id": G.grupoId } } } });
  const campoId = r.campos[0]!.id;
  respostaB = id();
  await b.db.transact(
    b.db.tx.respostas[respostaB]!.create({ valor: ["Duna"], chave: `${pB}:${campoId}` })
      .link({ participante: pB, campo: campoId }),
  );
});

afterAll(async () => {
  await limparTudo(PREFIXO);
});

describe("perfis visíveis", () => {
  test("flag ausente: membro e organizador não veem respostas de outro", async () => {
    expect(await respostasDeB(a)).toEqual({ viaParticipante: [], diretas: [] });
    expect((await respostasDeB(org)).diretas).toEqual([]);
  });

  test("membro não liga a flag; o organizador liga", async () => {
    await expect(a.db.transact(a.db.tx.grupos[G.grupoId]!.update({ perfisVisiveis: true }))).rejects.toThrow();
    await ligar(true);
  });

  test("flag ligada: membro e organizador veem", async () => {
    expect(await respostasDeB(a)).toEqual({ viaParticipante: [respostaB], diretas: [respostaB] });
    expect((await respostasDeB(org)).diretas).toEqual([respostaB]);
  });

  test("flag ligada: estranho com o código e membro de outro grupo não veem", async () => {
    expect((await respostasDeB(estranho, { codigo: G.codigo })).diretas).toEqual([]);
    expect((await respostasDeB(membroH)).diretas).toEqual([]);
  });

  test("flag desligada de novo: volta a não ver", async () => {
    await ligar(false);
    expect(await respostasDeB(a)).toEqual({ viaParticipante: [], diretas: [] });
    await ligar(true);
  });

  test("flag ligada: removido (removido + unlink do usuário) não vê", async () => {
    await org.db.transact(org.db.tx.participantes[pA]!.update({ removido: true }).unlink({ usuario: a.id }));
    expect((await respostasDeB(a)).diretas).toEqual([]);
  });
});
