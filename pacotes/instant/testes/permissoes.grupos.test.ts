// Suíte de permissões de grupos/campos/participantes/respostas/restrições.
// Roda contra o app de TESTE (amigo-secreto-teste). Ver pacotes/instant/perms.ts.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { id } from "@instantdb/admin";
import { gerarCodigo } from "@amigo/dominio";
import {
  adminTeste,
  criarGrupoTeste,
  criarUsuario,
  entrar,
  erroDe,
  limparTudo,
  novoPrefixo,
  tipoErro,
  type Usuario,
} from "./instant-teste";

setDefaultTimeout(30_000);

const PREFIXO = novoPrefixo("perm-grupos");
const admin = adminTeste();

let org: Usuario; // organizador de G (e participante de G)
let a: Usuario; // participante de G
let b: Usuario; // participante de G
let estranho: Usuario; // não é membro de nada
let orgH: Usuario; // organizador de H
let membroH: Usuario; // participante só de H
let G: { grupoId: string; codigo: string };
let H: { grupoId: string; codigo: string };
let pOrg: string;
let pA: string;
let pB: string;
let pMembroH: string; // participante de membroH em H
let pOrgEmH: string; // org (organizador de G) também é membro de H

async function esperarTipo(p: Promise<unknown>, tipo: string) {
  const e = await erroDe(p);
  expect(tipoErro(e)).toBe(tipo);
}

beforeAll(async () => {
  [org, a, b, estranho, orgH, membroH] = await Promise.all(
    Array.from({ length: 6 }, () => criarUsuario(PREFIXO)),
  );
  G = await criarGrupoTeste(org);
  H = await criarGrupoTeste(orgH);
  pOrg = await entrar(org, G.grupoId, G.codigo);
  pA = await entrar(a, G.grupoId, G.codigo);
  pB = await entrar(b, G.grupoId, G.codigo);
  pMembroH = await entrar(membroH, H.grupoId, H.codigo);
  pOrgEmH = await entrar(org, H.grupoId, H.codigo);
});

afterAll(async () => {
  await limparTudo(PREFIXO);
});

describe("grupos: visibilidade por código (ruleParams)", () => {
  test("1. não-membro sem ruleParams não vê grupo nenhum", async () => {
    const r = await estranho.db.query({ grupos: {} });
    expect(r.grupos).toEqual([]);
  });

  test("2. não-membro com o código certo vê exatamente o grupo e os campos", async () => {
    const r = await estranho.db.query(
      { grupos: { $: { where: { codigo: G.codigo } }, campos: {} } },
      { ruleParams: { codigo: G.codigo } },
    );
    expect(r.grupos.map((g) => g.id)).toEqual([G.grupoId]);
    expect(r.grupos[0]!.campos).toHaveLength(2);
  });

  test("2b. não-membro com o código certo vê os campos consultando campos direto", async () => {
    const r = await estranho.db.query(
      { campos: { $: { where: { "grupo.codigo": G.codigo } } } },
      { ruleParams: { codigo: G.codigo } },
    );
    expect(r.campos).toHaveLength(2);
  });

  test("3. não-membro com código errado não vê nada", async () => {
    const r = await estranho.db.query(
      { grupos: { $: { where: { codigo: G.codigo } }, campos: {} } },
      { ruleParams: { codigo: H.codigo } },
    );
    expect(r.grupos).toEqual([]);
    const r2 = await estranho.db.query(
      { grupos: { $: { where: { codigo: G.codigo } } } },
      { ruleParams: { codigo: "ZZZZZZ" } },
    );
    expect(r2.grupos).toEqual([]);
  });

  test("4. código certo sem where devolve só aquele grupo (sem enumeração)", async () => {
    const r = await estranho.db.query({ grupos: {} }, { ruleParams: { codigo: G.codigo } });
    expect(r.grupos.map((g) => g.id)).toEqual([G.grupoId]);
  });

  test("4b. código certo não abre participantes nem respostas do grupo", async () => {
    const r = await estranho.db.query(
      { grupos: { participantes: { respostas: {} } } },
      { ruleParams: { codigo: G.codigo } },
    );
    expect(r.grupos).toHaveLength(1);
    expect(r.grupos[0]!.participantes).toEqual([]);
    const r2 = await estranho.db.query({ participantes: {} }, { ruleParams: { codigo: G.codigo } });
    expect(r2.participantes).toEqual([]);
  });

  test("5. membro de outro grupo não vê o grupo G", async () => {
    const r = await membroH.db.query({ grupos: { campos: {}, participantes: {} } });
    expect(r.grupos.map((g) => g.id)).toEqual([H.grupoId]);
    const r2 = await membroH.db.query({ grupos: { $: { where: { id: G.grupoId } } } });
    expect(r2.grupos).toEqual([]);
  });

  test("membro vê o próprio grupo, os campos e os outros participantes", async () => {
    const r = await a.db.query({ grupos: { campos: {}, participantes: {} } });
    expect(r.grupos.map((g) => g.id)).toEqual([G.grupoId]);
    expect(r.grupos[0]!.campos).toHaveLength(2);
    expect(r.grupos[0]!.participantes.map((p) => p.id).sort()).toEqual([pOrg, pA, pB].sort());
  });
});

describe("participantes: entrada", () => {
  test("6. entrar com o código certo cria o participante; de novo dá record-not-unique", async () => {
    const u = await criarUsuario(PREFIXO);
    const pid = await entrar(u, G.grupoId, G.codigo);
    const r = await u.db.query({ participantes: { $: { where: { id: pid } } } });
    expect(r.participantes).toHaveLength(1);
    await esperarTipo(entrar(u, G.grupoId, G.codigo), "record-not-unique");
  });

  test("7. entrar com o código errado é negado", async () => {
    const u = await criarUsuario(PREFIXO);
    await esperarTipo(entrar(u, G.grupoId, H.codigo), "permission-denied");
    await esperarTipo(entrar(u, G.grupoId, "ZZZZZZ"), "permission-denied");
  });

  test("entrar com chave forjada (para burlar a unicidade) é negado", async () => {
    const pid = id();
    await esperarTipo(
      a.db.transact(
        a.db.tx.participantes[pid]!.ruleParams({ codigo: G.codigo })
          .create({
            apelido: "dup",
            perfilCompleto: false,
            removido: false,
            entrouEm: Date.now(),
            chave: `${G.grupoId}:${a.id}:outra`,
          })
          .link({ grupo: G.grupoId, usuario: a.id }),
      ),
      "permission-denied",
    );
  });

  test("criar participante em nome de outro usuário é negado", async () => {
    await esperarTipo(
      estranho.db.transact(
        estranho.db.tx.participantes[id()]!.ruleParams({ codigo: G.codigo })
          .create({
            apelido: "x",
            perfilCompleto: false,
            removido: false,
            entrouEm: Date.now(),
            chave: `${G.grupoId}:${membroH.id}`,
          })
          .link({ grupo: G.grupoId, usuario: membroH.id }),
      ),
      "permission-denied",
    );
  });

  test("entrar em grupo não aberto, mesmo com o código certo, é negado", async () => {
    const fechado = await criarGrupoTeste(orgH, { status: "sorteado" });
    const u = await criarUsuario(PREFIXO);
    await esperarTipo(entrar(u, fechado.grupoId, fechado.codigo), "permission-denied");
  });

  test("participante não pode ser movido para outro grupo", async () => {
    await esperarTipo(
      a.db.transact(a.db.tx.participantes[pA]!.link({ grupo: H.grupoId })),
      "permission-denied",
    );
    await esperarTipo(
      orgH.db.transact(orgH.db.tx.grupos[H.grupoId]!.link({ participantes: pA })),
      "permission-denied",
    );
    const r = await admin.query({ participantes: { $: { where: { id: pA } }, grupo: {} } });
    expect(r.participantes[0]!.grupo!.id).toBe(G.grupoId);
  });

  test("ninguém desliga participante ou campo do grupo pelo lado do grupo", async () => {
    await esperarTipo(
      a.db.transact(a.db.tx.grupos[G.grupoId]!.unlink({ participantes: pB })),
      "permission-denied",
    );
    await esperarTipo(
      org.db.transact(org.db.tx.grupos[G.grupoId]!.unlink({ participantes: pB })),
      "permission-denied",
    );
    const { campos } = await org.db.query({ campos: { $: { where: { "grupo.id": G.grupoId } } } });
    await esperarTipo(
      org.db.transact(org.db.tx.grupos[G.grupoId]!.unlink({ campos: campos[0]!.id })),
      "permission-denied",
    );
    const r = await admin.query({ grupos: { $: { where: { id: G.grupoId } }, participantes: {} } });
    expect(r.grupos[0]!.participantes.map((p) => p.id)).toContain(pB);
  });
});

describe("grupos: alteração", () => {
  test("8. organizador não muda status para sorteado; para encerrado, sim", async () => {
    const g = await criarGrupoTeste(org);
    await esperarTipo(
      org.db.transact(org.db.tx.grupos[g.grupoId]!.update({ status: "sorteado" })),
      "permission-denied",
    );
    await org.db.transact(org.db.tx.grupos[g.grupoId]!.update({ status: "encerrado" }));
    const r = await admin.query({ grupos: { $: { where: { id: g.grupoId } } } });
    expect(r.grupos[0]!.status).toBe("encerrado");
  });

  test("organizador não muda codigo nem rodadaAtual, mas muda título", async () => {
    await esperarTipo(
      org.db.transact(org.db.tx.grupos[G.grupoId]!.update({ codigo: "BBBBBB" })),
      "permission-denied",
    );
    await esperarTipo(
      org.db.transact(org.db.tx.grupos[G.grupoId]!.update({ rodadaAtual: 1 })),
      "permission-denied",
    );
    await org.db.transact(org.db.tx.grupos[G.grupoId]!.update({ titulo: "Novo título" }));
  });

  test("grupo não pode nascer já sorteado", async () => {
    await esperarTipo(
      org.db.transact(
        org.db.tx.grupos[id()]!.create({
          titulo: "x",
          tema: "livro",
          codigo: "BBBBB2",
          status: "sorteado",
          rodadaAtual: 0,
          criadoEm: Date.now(),
        }).link({ organizador: org.id }),
      ),
      "permission-denied",
    );
  });

  test("criar grupo em nome de outro organizador é negado", async () => {
    await esperarTipo(
      a.db.transact(
        a.db.tx.grupos[id()]!.create({
          titulo: "x",
          tema: "livro",
          codigo: "BBBBB3",
          status: "aberto",
          rodadaAtual: 0,
          criadoEm: Date.now(),
        }).link({ organizador: org.id }),
      ),
      "permission-denied",
    );
  });

  test("membro não altera nem apaga o grupo, e não vira organizador", async () => {
    await esperarTipo(
      a.db.transact(a.db.tx.grupos[G.grupoId]!.update({ titulo: "hack" })),
      "permission-denied",
    );
    await esperarTipo(a.db.transact(a.db.tx.grupos[G.grupoId]!.delete()), "permission-denied");
    await esperarTipo(
      a.db.transact(a.db.tx.grupos[G.grupoId]!.link({ organizador: a.id })),
      "permission-denied",
    );
    await esperarTipo(
      a.db.transact(a.db.tx.$users[a.id]!.link({ gruposOrganizados: G.grupoId })),
      "permission-denied",
    );
    const r = await admin.query({ grupos: { $: { where: { id: G.grupoId } }, organizador: {} } });
    expect(r.grupos[0]!.organizador!.id).toBe(org.id);
  });

  test("só o organizador cria, altera e apaga campos", async () => {
    const campoId = id();
    const novoCampo = (db: Usuario["db"]) =>
      db.transact(
        db.tx.campos[campoId]!.create({ rotulo: "x", tipo: "texto", obrigatorio: false, ordem: 9 })
          .link({ grupo: G.grupoId }),
      );
    await esperarTipo(novoCampo(a.db), "permission-denied");
    await novoCampo(org.db);
    await esperarTipo(
      a.db.transact(a.db.tx.campos[campoId]!.update({ rotulo: "hack" })),
      "permission-denied",
    );
    await esperarTipo(
      orgH.db.transact(orgH.db.tx.campos[campoId]!.update({ rotulo: "hack" })),
      "permission-denied",
    );
    await org.db.transact(org.db.tx.campos[campoId]!.update({ rotulo: "y" }));
    await esperarTipo(a.db.transact(a.db.tx.campos[campoId]!.delete()), "permission-denied");
    await org.db.transact(org.db.tx.campos[campoId]!.delete());
  });

  test("organizador de H não cria campo em G", async () => {
    await esperarTipo(
      orgH.db.transact(
        orgH.db.tx.campos[id()]!.create({ rotulo: "x", tipo: "texto", obrigatorio: false, ordem: 9 })
          .link({ grupo: G.grupoId }),
      ),
      "permission-denied",
    );
  });
});

describe("respostas", () => {
  let campoId: string;
  let respostaB: string;

  beforeAll(async () => {
    const r = await b.db.query({ campos: { $: { where: { "grupo.id": G.grupoId } } } });
    campoId = r.campos[0]!.id;
    respostaB = id();
    await b.db.transact(
      b.db.tx.respostas[respostaB]!.create({ valor: ["Duna"], chave: `${pB}:${campoId}` })
        .link({ participante: pB, campo: campoId }),
    );
  });

  test("9. A não vê as respostas de B antes do sorteio; o dono vê as próprias", async () => {
    const ra = await a.db.query({ respostas: {} });
    expect(ra.respostas).toEqual([]);
    const ra2 = await a.db.query({ participantes: { $: { where: { id: pB } }, respostas: {} } });
    expect(ra2.participantes[0]!.respostas).toEqual([]);
    const rb = await b.db.query({ respostas: {} });
    expect(rb.respostas.map((x) => x.id)).toEqual([respostaB]);
  });

  test("organizador não vê as respostas dos outros (administra, mas não vê)", async () => {
    const r = await org.db.query({ respostas: {} });
    expect(r.respostas).toEqual([]);
  });

  test("ninguém cria nem edita resposta em nome de outro", async () => {
    await esperarTipo(
      a.db.transact(
        a.db.tx.respostas[id()]!.create({ valor: ["x"], chave: `${pB}:${campoId}:a` })
          .link({ participante: pB, campo: campoId }),
      ),
      "permission-denied",
    );
    await esperarTipo(
      a.db.transact(a.db.tx.respostas[respostaB]!.update({ valor: ["hack"] })),
      "permission-denied",
    );
    await esperarTipo(
      b.db.transact(b.db.tx.respostas[respostaB]!.link({ participante: pA })),
      "permission-denied",
    );
  });

  test("resposta com campo de outro grupo é negada", async () => {
    const r = await orgH.db.query({ campos: { $: { where: { "grupo.id": H.grupoId } } } });
    const campoH = r.campos[0]!.id;
    await esperarTipo(
      a.db.transact(
        a.db.tx.respostas[id()]!.create({ valor: ["x"], chave: `${pA}:${campoH}` })
          .link({ participante: pA, campo: campoH }),
      ),
      "permission-denied",
    );
  });

  test("o dono edita; outro membro não apaga; o organizador apaga (limpeza)", async () => {
    await b.db.transact(b.db.tx.respostas[respostaB]!.update({ valor: ["Duna", "Fundação"] }));
    await esperarTipo(a.db.transact(a.db.tx.respostas[respostaB]!.delete()), "permission-denied");
    await org.db.transact(org.db.tx.respostas[respostaB]!.delete());
    const r = await admin.query({ respostas: { $: { where: { id: respostaB } } } });
    expect(r.respostas).toEqual([]);
  });
});

describe("participantes: alteração e remoção", () => {
  test("10. participante não edita o perfil de outro", async () => {
    await esperarTipo(
      a.db.transact(a.db.tx.participantes[pB]!.update({ apelido: "hack" })),
      "permission-denied",
    );
    await esperarTipo(
      a.db.transact(a.db.tx.participantes[pB]!.update({ perfilCompleto: true })),
      "permission-denied",
    );
  });

  test("participante edita o próprio apelido/perfil, mas não a chave", async () => {
    await a.db.transact(
      a.db.tx.participantes[pA]!.update({ apelido: "Ana", perfilCompleto: true, viuParNaRodada: 1 }),
    );
    await esperarTipo(
      a.db.transact(a.db.tx.participantes[pA]!.update({ chave: "outra" })),
      "permission-denied",
    );
  });

  test("organizador marca removido=true num membro; não edita o apelido dele", async () => {
    const u = await criarUsuario(PREFIXO);
    const pid = await entrar(u, G.grupoId, G.codigo);
    await org.db.transact(org.db.tx.participantes[pid]!.update({ removido: true }));
    await esperarTipo(
      org.db.transact(org.db.tx.participantes[pid]!.update({ apelido: "hack" })),
      "permission-denied",
    );
    await org.db.transact(org.db.tx.participantes[pid]!.unlink({ usuario: u.id }));
    const r = await admin.query({ participantes: { $: { where: { id: pid } }, usuario: {} } });
    expect(r.participantes[0]!.removido).toBe(true);
    expect(r.participantes[0]!.usuario).toBeUndefined();
  });

  test("remoção pela UI: removido + removidoNaRodada + unlink + respostas por lookup de chave", async () => {
    // O organizador não vê as respostas do membro (nem o e-mail dele): o id do usuário vem da chave
    // do participante e as respostas são apagadas por lookup de `chave` (inclusive as que não existem).
    const { lookup } = await import("@instantdb/admin");
    const u = await criarUsuario(PREFIXO);
    const pid = await entrar(u, G.grupoId, G.codigo);
    const { campos } = await admin.query({ campos: { $: { where: { "grupo.id": G.grupoId } } } });
    const [c1, c2] = campos.map((c) => c.id);
    await u.db.transact(
      u.db.tx.respostas[id()]!.create({ valor: "x", chave: `${pid}:${c1}` }).link({ participante: pid, campo: c1! }),
    );
    const vis = await org.db.query({ participantes: { $: { where: { id: pid } }, respostas: {} } });
    expect(vis.participantes[0]!.respostas).toEqual([]);
    const uid = vis.participantes[0]!.chave.split(":")[1]!;
    expect(uid).toBe(u.id);
    await org.db.transact([
      org.db.tx.participantes[pid]!.update({ removido: true, removidoNaRodada: 1 }).unlink({ usuario: uid }),
      org.db.tx.respostas[lookup("chave", `${pid}:${c1}`)]!.delete(),
      org.db.tx.respostas[lookup("chave", `${pid}:${c2}`)]!.delete(),
    ]);
    const r = await admin.query({ participantes: { $: { where: { id: pid } }, usuario: {}, respostas: {} } });
    expect(r.participantes[0]!.removido).toBe(true);
    expect(r.participantes[0]!.removidoNaRodada).toBe(1);
    expect(r.participantes[0]!.usuario).toBeUndefined();
    expect(r.participantes[0]!.respostas).toEqual([]);
    // Membro comum não marca removidoNaRodada em outro.
    await esperarTipo(
      a.db.transact(a.db.tx.participantes[pB]!.update({ removidoNaRodada: 1 })),
      "permission-denied",
    );
  });

  test("organizadorApelido: o organizador grava na criação e edita depois", async () => {
    const gid = id();
    await org.db.transact(
      org.db.tx.grupos[gid]!.create({
        titulo: `Grupo de ${org.email}`,
        tema: "livro",
        codigo: gerarCodigo(),
        status: "aberto",
        rodadaAtual: 0,
        criadoEm: Date.now(),
        organizadorApelido: "Org",
      }).link({ organizador: org.id }),
    );
    await org.db.transact(org.db.tx.grupos[gid]!.update({ organizadorApelido: "Organizadora" }));
    await esperarTipo(
      a.db.transact(a.db.tx.grupos[gid]!.update({ organizadorApelido: "hack" })),
      "permission-denied",
    );
    const r = await admin.query({ grupos: { $: { where: { id: gid } } } });
    expect(r.grupos[0]!.organizadorApelido).toBe("Organizadora");
  });

  test("o próprio não desfaz removido (true -> false)", async () => {
    const u = await criarUsuario(PREFIXO);
    const pid = await entrar(u, G.grupoId, G.codigo);
    await u.db.transact(u.db.tx.participantes[pid]!.update({ removido: true }));
    await esperarTipo(
      u.db.transact(u.db.tx.participantes[pid]!.update({ removido: false })),
      "permission-denied",
    );
    await esperarTipo(
      org.db.transact(org.db.tx.participantes[pid]!.update({ removido: false })),
      "permission-denied",
    );
  });

  test("membro não marca removido em outro participante", async () => {
    await esperarTipo(
      a.db.transact(a.db.tx.participantes[pB]!.update({ removido: true })),
      "permission-denied",
    );
    await esperarTipo(
      a.db.transact(a.db.tx.participantes[pB]!.unlink({ usuario: b.id })),
      "permission-denied",
    );
  });

  test("o próprio sai (removido + unlink do usuário) e deixa de ver o grupo", async () => {
    const u = await criarUsuario(PREFIXO);
    const pid = await entrar(u, G.grupoId, G.codigo);
    await u.db.transact(
      u.db.tx.participantes[pid]!.update({ removido: true }).unlink({ usuario: u.id }),
    );
    const r = await u.db.query({ grupos: {} });
    expect(r.grupos).toEqual([]);
  });

  test("o próprio apaga a participação com o grupo aberto; fechado, não", async () => {
    const u = await criarUsuario(PREFIXO);
    const pid = await entrar(u, G.grupoId, G.codigo);
    await u.db.transact(u.db.tx.participantes[pid]!.delete());

    const g = await criarGrupoTeste(org);
    const pid2 = await entrar(u, g.grupoId, g.codigo);
    await admin.transact(admin.tx.grupos[g.grupoId]!.update({ status: "sorteado" }));
    await esperarTipo(u.db.transact(u.db.tx.participantes[pid2]!.delete()), "permission-denied");
    await esperarTipo(a.db.transact(a.db.tx.participantes[pid2]!.delete()), "permission-denied");
    await org.db.transact(org.db.tx.participantes[pid2]!.delete());
  });
});

describe("restrições", () => {
  test("só o organizador cria e vê restrições", async () => {
    const rid = id();
    const nova = (db: Usuario["db"]) =>
      db.transact(
        db.tx.restricoes[rid]!.create({ motivo: "casal" })
          .link({ grupo: G.grupoId, participanteA: pA, participanteB: pB }),
      );
    await esperarTipo(nova(a.db), "permission-denied");
    await nova(org.db);
    expect((await a.db.query({ restricoes: {} })).restricoes).toEqual([]);
    expect((await org.db.query({ restricoes: {} })).restricoes.map((r) => r.id)).toEqual([rid]);
    // Nem quem é citado (A) apaga: só o organizador.
    await esperarTipo(a.db.transact(a.db.tx.restricoes[rid]!.delete()), "permission-denied");
    await org.db.transact(org.db.tx.restricoes[rid]!.delete());
  });

  test("restrição não muda de grupo nem de participantes depois de criada", async () => {
    const rid = id();
    await org.db.transact(
      org.db.tx.restricoes[rid]!.create({ motivo: "x" })
        .link({ grupo: G.grupoId, participanteA: pA, participanteB: pB }),
    );
    // org é membro de H, mas não pode empurrar a restrição para o sorteio de H.
    await esperarTipo(
      org.db.transact(org.db.tx.restricoes[rid]!.link({ grupo: H.grupoId })),
      "permission-denied",
    );
    await esperarTipo(
      org.db.transact(org.db.tx.restricoes[rid]!.link({ participanteA: pMembroH })),
      "permission-denied",
    );
    await esperarTipo(
      org.db.transact(org.db.tx.restricoes[rid]!.unlink({ participanteB: pB })),
      "permission-denied",
    );
    await esperarTipo(
      org.db.transact(org.db.tx.grupos[G.grupoId]!.unlink({ restricoes: rid })),
      "permission-denied",
    );
    const r = await admin.query({
      restricoes: { $: { where: { id: rid } }, grupo: {}, participanteA: {}, participanteB: {} },
    });
    expect(r.restricoes[0]!.grupo!.id).toBe(G.grupoId);
    expect(r.restricoes[0]!.participanteA!.id).toBe(pA);
    expect(r.restricoes[0]!.participanteB!.id).toBe(pB);
    await org.db.transact(org.db.tx.restricoes[rid]!.delete());
  });

  test("restrição em G com participantes de H é negada", async () => {
    await esperarTipo(
      org.db.transact(
        org.db.tx.restricoes[id()]!.create({ motivo: "x" })
          .link({ grupo: G.grupoId, participanteA: pMembroH, participanteB: pOrgEmH }),
      ),
      "permission-denied",
    );
    await esperarTipo(
      org.db.transact(
        org.db.tx.restricoes[id()]!.create({ motivo: "x" })
          .link({ grupo: G.grupoId, participanteA: pA, participanteB: pMembroH }),
      ),
      "permission-denied",
    );
  });
});

describe("organizador: criação do grupo no front", () => {
  test("uma só transação cria grupo, campos e o participante do organizador (sem ruleParams)", async () => {
    const o = await criarUsuario(PREFIXO);
    const grupoId = id();
    const campoIds = [id(), id()];
    const participanteId = id();
    await o.db.transact([
      o.db.tx.grupos[grupoId]!.create({
        titulo: "Front",
        tema: "livro",
        codigo: gerarCodigo(),
        status: "aberto",
        rodadaAtual: 0,
        criadoEm: Date.now(),
      }).link({ organizador: o.id }),
      ...campoIds.map((c, i) =>
        o.db.tx.campos[c]!.create({ rotulo: `c${i}`, tipo: "texto", obrigatorio: false, ordem: i })
          .link({ grupo: grupoId }),
      ),
      o.db.tx.participantes[participanteId]!.create({
        apelido: "Org",
        perfilCompleto: false,
        removido: false,
        entrouEm: Date.now(),
        chave: `${grupoId}:${o.id}`,
      }).link({ grupo: grupoId, usuario: o.id }),
    ]);
    const r = await admin.query({
      grupos: {
        $: { where: { id: grupoId } },
        organizador: {},
        campos: {},
        participantes: { usuario: {} },
      },
    });
    expect(r.grupos).toHaveLength(1);
    const g = r.grupos[0]!;
    expect(g.organizador!.id).toBe(o.id);
    expect(g.campos.map((c) => c.id).sort()).toEqual([...campoIds].sort());
    expect(g.participantes.map((p) => p.id)).toEqual([participanteId]);
    expect(g.participantes[0]!.usuario!.id).toBe(o.id);
    // E o organizador vê tudo como membro.
    const v = await o.db.query({ grupos: { campos: {}, participantes: {} } });
    expect(v.grupos.map((x) => x.id)).toEqual([grupoId]);
  });

  test("organizador não entra no próprio grupo depois que ele deixa de estar aberto", async () => {
    const o = await criarUsuario(PREFIXO);
    const g = await criarGrupoTeste(o, { status: "sorteado" });
    const semCodigo = o.db.transact(
      o.db.tx.participantes[id()]!.create({
        apelido: "Org",
        perfilCompleto: false,
        removido: false,
        entrouEm: Date.now(),
        chave: `${g.grupoId}:${o.id}`,
      }).link({ grupo: g.grupoId, usuario: o.id }),
    );
    await esperarTipo(semCodigo, "permission-denied");
    await esperarTipo(entrar(o, g.grupoId, g.codigo), "permission-denied");
  });
});

describe("rate limit de entrada", () => {
  test("11. a 21ª tentativa de entrada em 1 hora dá rate-limited", async () => {
    const u = await criarUsuario(PREFIXO);
    const fechado = await criarGrupoTeste(orgH, { status: "sorteado" });
    for (let i = 1; i <= 20; i++) {
      await esperarTipo(entrar(u, fechado.grupoId, fechado.codigo), "permission-denied");
    }
    await esperarTipo(entrar(u, fechado.grupoId, fechado.codigo), "rate-limited");
    // Mesmo num grupo aberto com o código certo, continua bloqueado.
    await esperarTipo(entrar(u, G.grupoId, G.codigo), "rate-limited");
  });
});
