// Suíte de permissões de conta ($users), apagar grupo em cascata e query_perms_check.
// Roda contra o app de TESTE (amigo-secreto-teste). Ver instant.perms.ts.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { id } from "@instantdb/admin";
import {
  adminTeste,
  criarGrupoTeste,
  criarUsuario,
  entrar,
  erroDe,
  limparTudo,
  novoPrefixo,
  simularWorker,
  tipoErro,
  type Usuario,
} from "./instant-teste";

setDefaultTimeout(30_000);

const PREFIXO = novoPrefixo("perm-conta");
const admin = adminTeste();

let O: Usuario;
let A: Usuario;
let B: Usuario;
let G: { grupoId: string; codigo: string };
let pO: string;
let pA: string;
let pB: string;
let sorteioId: string;
let parDeA: string;

beforeAll(async () => {
  [O, A, B] = await Promise.all([1, 2, 3].map(() => criarUsuario(PREFIXO)));
  G = await criarGrupoTeste(O);
  pO = await entrar(O, G.grupoId, G.codigo);
  pA = await entrar(A, G.grupoId, G.codigo);
  pB = await entrar(B, G.grupoId, G.codigo);
  sorteioId = id();
  await O.db.transact(
    O.db.tx.sorteios[sorteioId]!
      .create({ status: "pendente", rodada: 1, chave: `${G.grupoId}:1`, criadoEm: Date.now() })
      .link({ grupo: G.grupoId }),
  );
  await simularWorker(admin, sorteioId, [
    { doador: pA, receptor: pB },
    { doador: pB, receptor: pO },
    { doador: pO, receptor: pA },
  ]);
  const { pares } = await admin.query({ pares: { $: { where: { "doador.id": pA } } } });
  parDeA = pares[0]!.id;
});

afterAll(async () => {
  await limparTudo(PREFIXO);
});

describe("$users", () => {
  test("cada um vê só o próprio $users", async () => {
    const r = await A.db.query({ $users: {} });
    expect(r.$users.map((u) => u.id)).toEqual([A.id]);
  });

  // ACHADO (ideias.md §10): o instantdb-rust recusa regra de `delete` em `$users` no push
  // ("doesn't support permissions for delete") e recusa o delete pelo cliente como
  // `validation-failed` ("$users is a system entity"). O brief pedia "apagar o próprio → ok";
  // isso só é possível pelo admin (`auth.deleteUser`), num endpoint do servidor.
  test("1. cliente não apaga $users (nem o próprio, nem o de outro)", async () => {
    const proprio = await erroDe(A.db.transact(A.db.tx.$users[A.id]!.delete()));
    expect(tipoErro(proprio)).toBe("validation-failed");
    const outro = await erroDe(A.db.transact(A.db.tx.$users[B.id]!.delete()));
    expect(["validation-failed", "permission-denied"]).toContain(tipoErro(outro) ?? "");
    const { $users } = await admin.query({ $users: { $: { where: { id: { $in: [A.id, B.id] } } } } });
    expect($users).toHaveLength(2);
  });
});

describe("query_perms_check (admin debugQuery)", () => {
  test("3. 'A vê pares': o resultado é só o par de A, avaliado pela regra publicada", async () => {
    const r = await admin.asUser({ email: A.email }).debugQuery({ pares: {} });
    expect(r.result.pares.map((p: { id: string }) => p.id)).toEqual([parDeA]);
    // Uma checagem por par do grupo, com o código da regra publicada.
    const checks = r.checkResults as unknown as { id: string; program: { code: string } }[];
    expect(checks).toHaveLength(3);
    for (const c of checks) {
      expect(c.program.code).toBe("auth.id != null && auth.id in data.ref('doador.usuario.id')");
    }
  });

  // ACHADO (ideias.md §10): nas `check-results` do instantdb-rust, `data.ref(...)` não é
  // resolvido e toda checagem com ref sai `false`, inclusive a do par que de fato aparece em
  // `result`. Teste marcado como `failing`: quando o servidor corrigir, ele fica vermelho.
  test.failing("3b. check-results marca true só no par de A", async () => {
    const r = await admin.asUser({ email: A.email }).debugQuery({ pares: {} });
    const checks = r.checkResults as { id: string; check: boolean }[];
    expect(checks.filter((c) => c.check).map((c) => c.id)).toEqual([parDeA]);
  });
});

describe("apagar grupo", () => {
  test("2. organizador apaga o grupo: campos, participantes, respostas, restrições, sorteios e pares somem", async () => {
    const { campos } = await admin.query({ campos: { $: { where: { "grupo.id": G.grupoId } } } });
    const campoId = campos[0]!.id;
    const respostaId = id();
    const restricaoId = id();
    await A.db.transact(
      A.db.tx.respostas[respostaId]!
        .create({ valor: "x", chave: `${pA}:${campoId}` })
        .link({ participante: pA, campo: campoId }),
    );
    await O.db.transact(
      O.db.tx.restricoes[restricaoId]!.create({}).link({ grupo: G.grupoId, participanteA: pA, participanteB: pB }),
    );
    // Membro não apaga o grupo nem os pares/sorteio.
    for (const passo of [
      A.db.tx.grupos[G.grupoId]!.delete(),
      A.db.tx.sorteios[sorteioId]!.delete(),
      A.db.tx.pares[parDeA]!.delete(),
    ]) {
      expect(tipoErro(await erroDe(A.db.transact(passo)))).toBe("permission-denied");
    }

    const { pares: paresAntes } = await admin.query({
      pares: { $: { where: { "sorteio.id": sorteioId } } },
    });
    expect(paresAntes).toHaveLength(3);

    await O.db.transact(O.db.tx.grupos[G.grupoId]!.delete());

    const r = await admin.query({
      grupos: { $: { where: { id: G.grupoId } } },
      campos: { $: { where: { id: campoId } } },
      participantes: { $: { where: { id: { $in: [pO, pA, pB] } } } },
      respostas: { $: { where: { id: respostaId } } },
      restricoes: { $: { where: { id: restricaoId } } },
      sorteios: { $: { where: { id: sorteioId } } },
      pares: { $: { where: { id: { $in: paresAntes.map((p) => p.id) } } } },
    });
    expect(r.grupos).toEqual([]);
    expect(r.campos).toEqual([]);
    expect(r.participantes).toEqual([]);
    expect(r.respostas).toEqual([]);
    expect(r.restricoes).toEqual([]);
    expect(r.sorteios).toEqual([]);
    expect(r.pares).toEqual([]);
  });
});
