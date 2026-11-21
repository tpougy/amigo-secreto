// Suíte de permissões de conta ($users), apagar grupo em cascata e query_perms_check.
// Roda contra o app de TESTE (amigo-secreto-teste). Ver pacotes/instant/perms.ts.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { id, lookup } from "@instantdb/admin";
import {
  adminTeste,
  adminTesteSemSchema,
  comoCliente,
  esperarAte,
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

// ---------------------------------------------------------------------------------------
// Task 14: capa ($files), progresso por stream ($streams), pedido de exclusão e sair do grupo.

describe("capa do grupo ($files)", () => {
  let O2: Usuario;
  let M: Usuario; // membro
  let E: Usuario; // estranho
  let G2: { grupoId: string; codigo: string };
  let G3: { grupoId: string; codigo: string }; // outro grupo, de E
  let caminho: string;
  const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9])], { type: "image/jpeg" });

  beforeAll(async () => {
    [O2, M, E] = await Promise.all([1, 2, 3].map(() => criarUsuario(PREFIXO)));
    G2 = await criarGrupoTeste(O2, { organizadorParticipa: true });
    G3 = await criarGrupoTeste(E);
    await entrar(M, G2.grupoId, G2.codigo);
    caminho = `grupos/${G2.grupoId}/capa.jpg`;
  });

  test("organizador envia a capa e liga ao grupo", async () => {
    await comoCliente(O2, async (db) => {
      const r = await db.storage.uploadFile(caminho, jpeg(), { contentType: "image/jpeg" });
      expect(r.data.id).toBeTruthy();
      // Fora do navegador o transact volta "enqueued": espera o commit antes de desligar o cliente.
      await db.transact(db.tx.grupos[G2.grupoId]!.link({ capa: r.data.id }));
      await esperarAte(async () => {
        const { grupos } = await admin.query({ grupos: { $: { where: { id: G2.grupoId } }, capa: {} } });
        return grupos[0]?.capa?.path === caminho;
      });
    });
  });

  test("não-organizador não envia; organizador não envia fora do próprio grupo", async () => {
    await comoCliente(E, async (db) => {
      await erroDe(db.storage.uploadFile(caminho, jpeg(), { contentType: "image/jpeg" }));
    });
    await comoCliente(M, async (db) => {
      await erroDe(db.storage.uploadFile(`grupos/${G2.grupoId}/outra.jpg`, jpeg(), { contentType: "image/jpeg" }));
    });
    await comoCliente(O2, async (db) => {
      await erroDe(db.storage.uploadFile(`grupos/${G3.grupoId}/capa.jpg`, jpeg(), { contentType: "image/jpeg" }));
      await erroDe(db.storage.uploadFile(`soltos/capa.jpg`, jpeg(), { contentType: "image/jpeg" }));
    });
    const { $files } = await admin.query({ $files: { $: { where: { path: { $like: `%${G2.grupoId}%` } } } } });
    expect($files.map((f) => f.path)).toEqual([caminho]);
    const { $files: outros } = await admin.query({ $files: { $: { where: { path: { $in: [`grupos/${G3.grupoId}/capa.jpg`, "soltos/capa.jpg"] } } } } });
    expect(outros).toEqual([]);
  });

  test("a capa é visível para o membro e invisível para o não-membro", async () => {
    const m = await M.db.query({ grupos: { $: { where: { id: G2.grupoId } }, capa: {} }, $files: {} });
    expect(m.grupos[0]!.capa?.path).toBe(caminho);
    expect(m.$files.map((f) => f.path)).toEqual([caminho]);
    expect(m.$files[0]!.url).toBeTruthy();
    const e = await E.db.query({ $files: {} });
    expect(e.$files).toEqual([]);
    // Nem com o código (prévia): o grupo aparece, o arquivo não. ACHADO (ideias.md §10): o
    // instantdb-rust devolve o id do link (string) no lugar do objeto escondido; sem path nem url.
    const p = await E.db.query({ grupos: { $: { where: { codigo: G2.codigo } }, capa: {} } }, { ruleParams: { codigo: G2.codigo } });
    expect(p.grupos).toHaveLength(1);
    const capa = p.grupos[0]!.capa as unknown;
    expect(capa == null || typeof capa === "string").toBe(true);
  });

  test("organizador não liga ao próprio grupo a capa de outro grupo", async () => {
    // E organiza G3 e envia a capa de G3. O2 tenta ligar esse arquivo a G2: com a capa de G3 já
    // ligada, o has-one recusa (record-not-unique); sem ligação, a regra de link do $files recusa.
    const caminhoG3 = `grupos/${G3.grupoId}/capa.jpg`;
    const up = await admin.storage.uploadFile(caminhoG3, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { contentType: "image/jpeg" });
    try {
      const solto = await erroDe(O2.db.transact(O2.db.tx.grupos[G2.grupoId]!.link({ capa: up.data.id })));
      expect(tipoErro(solto)).toBe("permission-denied");
      await admin.transact(admin.tx.grupos[G3.grupoId]!.link({ capa: up.data.id }));
      const ligado = await erroDe(O2.db.transact(O2.db.tx.grupos[G2.grupoId]!.link({ capa: up.data.id })));
      expect(["permission-denied", "record-not-unique"]).toContain(tipoErro(ligado) ?? "");
      const r = await admin.query({ grupos: { $: { where: { id: { $in: [G2.grupoId, G3.grupoId] } } }, capa: {} } });
      expect(r.grupos.find((g) => g.id === G2.grupoId)!.capa?.path).toBe(caminho);
      expect(r.grupos.find((g) => g.id === G3.grupoId)!.capa?.path).toBe(caminhoG3);
    } finally {
      await admin.storage.delete(caminhoG3);
    }
  });

  test("membro e estranho não apagam a capa nem a desligam", async () => {
    for (const u of [M, E]) {
      await erroDe(u.db.transact(u.db.tx.$files[lookup("path", caminho)]!.delete()));
      await erroDe(u.db.transact(u.db.tx.grupos[G2.grupoId]!.unlink({ capa: (await admin.query({ $files: { $: { where: { path: caminho } } } })).$files[0]!.id })));
    }
    const { grupos } = await admin.query({ grupos: { $: { where: { id: G2.grupoId } }, capa: {} } });
    expect(grupos[0]!.capa?.path).toBe(caminho);
  });

  test("progresso do sorteio por stream: membro lê, estranho não", async () => {
    const sorteioId = id();
    await O2.db.transact(
      O2.db.tx.sorteios[sorteioId]!
        .create({ status: "pendente", rodada: 1, chave: `${G2.grupoId}:1`, criadoEm: Date.now() })
        .link({ grupo: G2.grupoId }),
    );
    const clientId = `sorteio-${sorteioId}`;
    const w = admin.streams.createWriteStream({ clientId }).getWriter();
    await w.write("embaralhando\n");
    await w.write("pronto\n");
    await w.close();
    const ler = (u: Usuario) =>
      comoCliente(u, async (db) => {
        const leitor = db.streams.createReadStream({ clientId }).getReader();
        let texto = "";
        const prazo = setTimeout(() => void leitor.cancel().catch(() => {}), 5000);
        try {
          for (;;) {
            const { value, done } = await leitor.read();
            if (done) break;
            texto += value;
          }
        } catch {
          texto += "<erro>";
        } finally {
          clearTimeout(prazo);
        }
        return texto;
      });
    expect(await ler(M)).toBe("embaralhando\npronto\n");
    expect(await ler(E)).not.toContain("pronto");
    const semSchema = adminTesteSemSchema();
    const { $streams } = await semSchema.query({ $streams: { $: { where: { clientId } } } });
    expect($streams).toHaveLength(1);
    await semSchema.transact($streams.map((s) => semSchema.tx.$streams[s.id]!.delete()));
    await admin.transact(admin.tx.sorteios[sorteioId]!.delete());
  });

  test("organizador apaga o grupo junto com a capa", async () => {
    await O2.db.transact([
      O2.db.tx.$files[lookup("path", caminho)]!.delete(),
      O2.db.tx.grupos[G2.grupoId]!.delete(),
    ]);
    const r = await admin.query({ grupos: { $: { where: { id: G2.grupoId } } }, $files: { $: { where: { path: caminho } } } });
    expect(r.grupos).toEqual([]);
    expect(r.$files).toEqual([]);
  });
});

describe("pedidosExclusao", () => {
  let P: Usuario;
  let Q: Usuario;
  let pedido: string;

  beforeAll(async () => {
    [P, Q] = await Promise.all([1, 2].map(() => criarUsuario(PREFIXO)));
  });

  test("o próprio usuário cria o pedido ligado a si e o vê; outro não vê", async () => {
    pedido = id();
    await P.db.transact(
      P.db.tx.pedidosExclusao[pedido]!.create({ criadoEm: Date.now(), status: "pendente" }).link({ usuario: P.id }),
    );
    expect((await P.db.query({ pedidosExclusao: {} })).pedidosExclusao.map((x) => x.id)).toEqual([pedido]);
    expect((await Q.db.query({ pedidosExclusao: {} })).pedidosExclusao).toEqual([]);
  });

  test("não cria pedido para outra pessoa, sem dono ou já concluído", async () => {
    for (const passo of [
      Q.db.tx.pedidosExclusao[id()]!.create({ criadoEm: Date.now(), status: "pendente" }).link({ usuario: P.id }),
      Q.db.tx.pedidosExclusao[id()]!.create({ criadoEm: Date.now(), status: "pendente" }),
      Q.db.tx.pedidosExclusao[id()]!.create({ criadoEm: Date.now(), status: "concluido" }).link({ usuario: Q.id }),
    ]) {
      expect(tipoErro(await erroDe(Q.db.transact(passo)))).toBe("permission-denied");
    }
    const { pedidosExclusao } = await admin.query({ pedidosExclusao: { usuario: {} } });
    expect(pedidosExclusao.filter((x) => x.usuario?.id === Q.id || !x.usuario)).toEqual([]);
  });

  test("o pedido é imutável para o cliente (update, delete, unlink)", async () => {
    for (const passo of [
      P.db.tx.pedidosExclusao[pedido]!.update({ status: "concluido" }),
      P.db.tx.pedidosExclusao[pedido]!.delete(),
      P.db.tx.pedidosExclusao[pedido]!.unlink({ usuario: P.id }),
    ]) {
      expect(tipoErro(await erroDe(P.db.transact(passo)))).toBe("permission-denied");
    }
    const { pedidosExclusao } = await admin.query({ pedidosExclusao: { $: { where: { id: pedido } }, usuario: {} } });
    expect(pedidosExclusao[0]!.status).toBe("pendente");
    expect(pedidosExclusao[0]!.usuario?.id).toBe(P.id);
  });

  afterAll(async () => {
    await admin.transact(admin.tx.pedidosExclusao[pedido]!.delete());
  });
});

describe("sair do grupo antes do sorteio", () => {
  test("delete do próprio participante leva as respostas; a restrição fica órfã; dá para entrar de novo", async () => {
    const [O3, S, T] = await Promise.all([1, 2, 3].map(() => criarUsuario(PREFIXO)));
    const G4 = await criarGrupoTeste(O3!, { organizadorParticipa: true });
    const pS = await entrar(S!, G4.grupoId, G4.codigo);
    const pT = await entrar(T!, G4.grupoId, G4.codigo);
    const { campos } = await admin.query({ campos: { $: { where: { "grupo.id": G4.grupoId } } } });
    const respostaId = id();
    await S!.db.transact(
      S!.db.tx.respostas[respostaId]!.create({ valor: "x", chave: `${pS}:${campos[0]!.id}` }).link({ participante: pS, campo: campos[0]!.id }),
    );
    const restricaoId = id();
    await O3!.db.transact(
      O3!.db.tx.restricoes[restricaoId]!.create({}).link({ grupo: G4.grupoId, participanteA: pT, participanteB: pS }),
    );
    // Quem é citado numa restrição não a vê nem a apaga, mas sai do grupo: sem cascata nos
    // participantes, a restrição fica órfã (o sorteio a ignora).
    expect((await S!.db.query({ restricoes: {} })).restricoes).toEqual([]);
    expect(tipoErro(await erroDe(S!.db.transact(S!.db.tx.restricoes[restricaoId]!.delete())))).toBe("permission-denied");
    await S!.db.transact(S!.db.tx.participantes[pS]!.delete());
    const r = await admin.query({
      participantes: { $: { where: { id: pS } } },
      respostas: { $: { where: { id: respostaId } } },
    });
    expect(r.participantes).toEqual([]);
    expect(r.respostas).toEqual([]);
    // O organizador vê a restrição órfã (sem o lado B) e consegue apagá-la.
    const o = await O3!.db.query({ restricoes: { $: { where: { id: restricaoId } }, participanteA: {}, participanteB: {} } });
    expect(o.restricoes).toHaveLength(1);
    expect(o.restricoes[0]!.participanteA?.id).toBe(pT);
    expect(o.restricoes[0]!.participanteB ?? null).toBeNull();
    await O3!.db.transact(O3!.db.tx.restricoes[restricaoId]!.delete());
    expect((await admin.query({ restricoes: { $: { where: { id: restricaoId } } } })).restricoes).toEqual([]);
    // A chave única foi liberada: S entra de novo. T não apaga a participação de S.
    const pS2 = await entrar(S!, G4.grupoId, G4.codigo);
    expect(tipoErro(await erroDe(T!.db.transact(T!.db.tx.participantes[pS2]!.delete())))).toBe("permission-denied");
  });
});
