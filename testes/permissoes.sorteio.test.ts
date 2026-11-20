// Suíte de permissões de sorteios e pares (e o efeito do sorteio sobre respostas).
// Roda contra o app de TESTE (amigo-secreto-teste). Ver instant.perms.ts.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { id } from "@instantdb/admin";
import { init as initCliente } from "@instantdb/core";
import schema from "../instant.schema";
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

const PREFIXO = novoPrefixo("perm-sorteio");
const admin = adminTeste();

let O: Usuario; // organizador de G (e participante)
let A: Usuario;
let B: Usuario;
let C: Usuario;
let estranho: Usuario; // não é membro de G
let G: { grupoId: string; codigo: string };
let pO: string;
let pA: string;
let pB: string;
let pC: string;
let sorteio1: string;
/** id da resposta de cada participante (campo 1 de G). */
const resposta: Record<string, string> = {};

async function esperarTipo(p: Promise<unknown>, tipo: string) {
  const e = await erroDe(p);
  expect(tipoErro(e)).toBe(tipo);
}

/** O usuário pede o sorteio da rodada (como o botão "Sortear" fará). */
async function pedirSorteio(
  u: Usuario,
  grupoId: string,
  rodada: number,
  chave = `${grupoId}:${rodada}`,
): Promise<string> {
  const sorteioId = id();
  await u.db.transact(
    u.db.tx.sorteios[sorteioId]!
      .create({ status: "pendente", rodada, chave, criadoEm: Date.now() })
      .link({ grupo: grupoId }),
  );
  return sorteioId;
}

/** Como admin, marca o sorteio como erro e libera a chave (ruling do worker). */
async function marcarErro(grupoId: string, sorteioId: string, rodada: number) {
  await admin.transact(
    admin.tx.sorteios[sorteioId]!.update({
      status: "erro",
      erro: "teste",
      chave: `${grupoId}:${rodada}:erro:${sorteioId}`,
    }),
  );
}

async function idsRespostasVisiveis(u: Usuario): Promise<string[]> {
  const r = await u.db.query({ respostas: {} });
  return r.respostas.map((x) => x.id).sort();
}

beforeAll(async () => {
  [O, A, B, C, estranho] = await Promise.all(
    Array.from({ length: 5 }, () => criarUsuario(PREFIXO)),
  );
  G = await criarGrupoTeste(O);
  pO = await entrar(O, G.grupoId, G.codigo);
  pA = await entrar(A, G.grupoId, G.codigo);
  pB = await entrar(B, G.grupoId, G.codigo);
  pC = await entrar(C, G.grupoId, G.codigo);

  const { campos } = await admin.query({ campos: { $: { where: { "grupo.id": G.grupoId } } } });
  const campoId = campos[0]!.id;
  for (const [u, pid] of [
    [O, pO],
    [A, pA],
    [B, pB],
    [C, pC],
  ] as const) {
    const rid = id();
    await u.db.transact(
      u.db.tx.respostas[rid]!
        .create({ valor: `resposta de ${pid}`, chave: `${pid}:${campoId}` })
        .link({ participante: pid, campo: campoId }),
    );
    resposta[pid] = rid;
  }

  // O pede a rodada 1 e o "worker" sorteia A→B, B→C, C→O, O→A.
  sorteio1 = await pedirSorteio(O, G.grupoId, 1);
  await simularWorker(admin, sorteio1, [
    { doador: pA, receptor: pB },
    { doador: pB, receptor: pC },
    { doador: pC, receptor: pO },
    { doador: pO, receptor: pA },
  ]);
});

afterAll(async () => {
  await limparTudo(PREFIXO);
});

describe("pares: cada um vê só o próprio", () => {
  test("estado depois do worker (sanidade, via admin)", async () => {
    const r = await admin.query({
      grupos: { $: { where: { id: G.grupoId } } },
      sorteios: { $: { where: { id: sorteio1 } }, pares: {} },
    });
    expect(r.grupos[0]!.status).toBe("sorteado");
    expect(r.grupos[0]!.rodadaAtual).toBe(1);
    expect(r.sorteios[0]!.status).toBe("concluido");
    expect(r.sorteios[0]!.pares).toHaveLength(4);
  });

  test("1. A consulta todos os pares e vê só o próprio (receptor B)", async () => {
    const r = await A.db.query({ pares: { doador: {}, receptor: {} } });
    expect(r.pares).toHaveLength(1);
    expect(r.pares[0]!.doador?.id).toBe(pA);
    expect(r.pares[0]!.receptor?.id).toBe(pB);
    // Pelo sorteio, também só o próprio par.
    const r2 = await A.db.query({ sorteios: { pares: { receptor: {} } } });
    expect(r2.sorteios.map((s) => s.id)).toEqual([sorteio1]);
    expect(r2.sorteios[0]!.pares.map((p) => p.receptor?.id)).toEqual([pB]);
    // Pelo participante: o recebidoDe dele mesmo não aparece (ele não é o doador).
    const r3 = await A.db.query({ participantes: { recebidoDe: {}, doando: {} } });
    const doandos = r3.participantes.flatMap((p) => (p.doando ? [p.doando.id] : []));
    const recebidos = r3.participantes.flatMap((p) => (p.recebidoDe ? [p.recebidoDe.id] : []));
    expect(doandos).toHaveLength(1);
    expect(recebidos).toEqual(doandos); // o único par visível é o dele (A→B)
  });

  test("2. O (organizador) vê só o próprio par (O→A), nunca os outros 3", async () => {
    const r = await O.db.query({ pares: { doador: {}, receptor: {} } });
    expect(r.pares).toHaveLength(1);
    expect(r.pares[0]!.doador?.id).toBe(pO);
    expect(r.pares[0]!.receptor?.id).toBe(pA);
    const r2 = await O.db.query({ sorteios: { pares: {} } });
    expect(r2.sorteios[0]!.pares).toHaveLength(1);
  });

  test("não-membro não vê sorteios nem pares", async () => {
    const r = await estranho.db.query({ sorteios: {}, pares: {} });
    expect(r.sorteios).toEqual([]);
    expect(r.pares).toEqual([]);
  });

  test("membro vê o sorteio do grupo", async () => {
    const r = await C.db.query({ sorteios: {} });
    expect(r.sorteios.map((s) => s.id)).toEqual([sorteio1]);
  });

  test("3. A não cria par, não muda sorteios.status, não apaga par nem sorteio", async () => {
    await esperarTipo(
      A.db.transact(
        A.db.tx.pares[id()]!
          .create({ chave: `${sorteio1}:${pA}x` })
          .link({ sorteio: sorteio1, doador: pC, receptor: pA }),
      ),
      "permission-denied",
    );
    await esperarTipo(
      A.db.transact(A.db.tx.sorteios[sorteio1]!.update({ status: "pendente" })),
      "permission-denied",
    );
    // Nem o organizador mexe no sorteio.
    await esperarTipo(
      O.db.transact(O.db.tx.sorteios[sorteio1]!.update({ status: "erro" })),
      "permission-denied",
    );
    const { pares } = await A.db.query({ pares: {} });
    await esperarTipo(
      A.db.transact(A.db.tx.pares[pares[0]!.id]!.delete()),
      "permission-denied",
    );
    await esperarTipo(
      A.db.transact(A.db.tx.sorteios[sorteio1]!.delete()),
      "permission-denied",
    );
  });

  test("A não troca o próprio receptor por links (par nem participante)", async () => {
    const { pares } = await A.db.query({ pares: {} });
    const parA = pares[0]!.id;
    await esperarTipo(
      A.db.transact(A.db.tx.pares[parA]!.link({ receptor: pC })),
      "permission-denied",
    );
    await esperarTipo(
      A.db.transact(A.db.tx.participantes[pA]!.unlink({ doando: parA })),
      "permission-denied",
    );
    const { pares: todos } = await admin.query({ pares: { $: { where: { id: parA } }, receptor: {} } });
    expect(todos[0]!.receptor?.id).toBe(pB);
  });
});

describe("respostas depois do sorteio", () => {
  test("4. A vê as respostas de B (que tirou), e não as de C nem as de O", async () => {
    expect(await idsRespostasVisiveis(A)).toEqual([resposta[pA]!, resposta[pB]!].sort());
  });

  test("5. O vê as respostas de A (que tirou), e não as de B nem as de C", async () => {
    expect(await idsRespostasVisiveis(O)).toEqual([resposta[pO]!, resposta[pA]!].sort());
  });

  test("quem NÃO tirou B não vê as respostas de B (C e O)", async () => {
    for (const u of [C, O]) {
      const r = await u.db.query({ respostas: { $: { where: { "participante.id": pB } } } });
      expect(r.respostas).toEqual([]);
    }
    // Nem navegando pelo participante B.
    const r = await C.db.query({ participantes: { $: { where: { id: pB } }, respostas: {} } });
    expect(r.participantes[0]!.respostas).toEqual([]);
  });
});

describe("pedidos de sorteio", () => {
  test("6. O pede a rodada 1 de novo → record-not-unique", async () => {
    await esperarTipo(pedirSorteio(O, G.grupoId, 1), "record-not-unique");
  });

  test("7. pedir a rodada 4 → permission-denied", async () => {
    await esperarTipo(pedirSorteio(O, G.grupoId, 4), "permission-denied");
  });

  test("8. participante (não organizador) pedir sorteio → permission-denied", async () => {
    await esperarTipo(pedirSorteio(A, G.grupoId, 2), "permission-denied");
  });
});

describe("participante depois do sorteio", () => {
  test("9. A grava viuParNaRodada no próprio participante; no de B, não", async () => {
    await A.db.transact(A.db.tx.participantes[pA]!.update({ viuParNaRodada: 1 }));
    const { participantes } = await admin.query({
      participantes: { $: { where: { id: pA } } },
    });
    expect(participantes[0]!.viuParNaRodada).toBe(1);
    await esperarTipo(
      A.db.transact(A.db.tx.participantes[pB]!.update({ viuParNaRodada: 1 })),
      "permission-denied",
    );
  });

  test("11. a query de (1) pelo SDK cliente (@instantdb/core) dá o mesmo resultado", async () => {
    const r = await paresComoCliente(A);
    expect(r.pares).toHaveLength(1);
    expect(r.pares[0]!.doador?.id).toBe(pA);
    expect(r.pares[0]!.receptor?.id).toBe(pB);
  });

  test("rodada 2: o worker troca os pares e as respostas visíveis acompanham", async () => {
    const sorteio2 = await pedirSorteio(O, G.grupoId, 2);
    await simularWorker(admin, sorteio2, [
      { doador: pA, receptor: pC },
      { doador: pC, receptor: pB },
      { doador: pB, receptor: pO },
      { doador: pO, receptor: pA },
    ]);
    const r = await A.db.query({ pares: { receptor: {}, sorteio: {} } });
    expect(r.pares).toHaveLength(1);
    expect(r.pares[0]!.receptor?.id).toBe(pC);
    expect(r.pares[0]!.sorteio?.id).toBe(sorteio2);
    expect(await idsRespostasVisiveis(A)).toEqual([resposta[pA]!, resposta[pC]!].sort());
    const { pares } = await admin.query({ pares: { $: { where: { "sorteio.grupo.id": G.grupoId } } } });
    expect(pares).toHaveLength(4);
  });

  test("10. A não sai (delete) com o grupo sorteado; O remove A (removido + unlink)", async () => {
    await esperarTipo(
      A.db.transact(A.db.tx.participantes[pA]!.delete()),
      "permission-denied",
    );
    await O.db.transact(
      O.db.tx.participantes[pA]!.update({ removido: true }).unlink({ usuario: A.id }),
    );
    const { participantes } = await admin.query({
      participantes: { $: { where: { id: pA } }, usuario: {} },
    });
    expect(participantes[0]!.removido).toBe(true);
    expect(participantes[0]!.usuario).toBeFalsy();
    // Sem o vínculo, A deixa de ver o par e o grupo.
    const r = await A.db.query({ pares: {}, grupos: {} });
    expect(r.pares).toEqual([]);
    expect(r.grupos).toEqual([]);
  });
});

describe("sorteio com erro, chave e limites", () => {
  let O2: Usuario;
  let O3: Usuario;
  let O4: Usuario;
  let G2: { grupoId: string; codigo: string };
  let G3: { grupoId: string; codigo: string };
  let G4: { grupoId: string; codigo: string };

  beforeAll(async () => {
    // Um organizador por cenário: o rateLimit (5/hora) é por usuário.
    [O2, O3, O4] = await Promise.all([1, 2, 3].map(() => criarUsuario(PREFIXO)));
    G2 = await criarGrupoTeste(O2, { organizadorParticipa: true });
    G3 = await criarGrupoTeste(O3, { organizadorParticipa: true, status: "encerrado" });
    G4 = await criarGrupoTeste(O4, { organizadorParticipa: true });
  });

  test("depois de erro com a chave renomeada, o organizador repete a mesma rodada", async () => {
    const s1 = await pedirSorteio(O2, G2.grupoId, 1);
    await esperarTipo(pedirSorteio(O2, G2.grupoId, 1), "record-not-unique");
    await marcarErro(G2.grupoId, s1, 1);
    const s2 = await pedirSorteio(O2, G2.grupoId, 1);
    const { sorteios } = await admin.query({
      sorteios: { $: { where: { "grupo.id": G2.grupoId } } },
    });
    expect(sorteios.map((s) => s.id).sort()).toEqual([s1, s2].sort());
    expect(sorteios.find((s) => s.id === s2)!.status).toBe("pendente");
  });

  test("chave forjada (fora de <grupoId>:<rodada>) → permission-denied", async () => {
    await esperarTipo(
      pedirSorteio(O2, G2.grupoId, 1, `${G2.grupoId}:1:outra`),
      "permission-denied",
    );
  });

  test("com rodadaAtual 3, a rodada 4 é negada (limite de 3 rodadas)", async () => {
    await admin.transact(admin.tx.grupos[G2.grupoId]!.update({ status: "sorteado", rodadaAtual: 3 }));
    await esperarTipo(pedirSorteio(O2, G2.grupoId, 4), "permission-denied");
  });

  test("sorteio nasce pendente: outro status → permission-denied", async () => {
    const sorteioId = id();
    await esperarTipo(
      O4.db.transact(
        O4.db.tx.sorteios[sorteioId]!
          .create({ status: "concluido", rodada: 1, chave: `${G4.grupoId}:1`, criadoEm: Date.now() })
          .link({ grupo: G4.grupoId }),
      ),
      "permission-denied",
    );
    // O mesmo pedido, pendente, passa.
    await pedirSorteio(O4, G4.grupoId, 1);
  });

  test("grupo encerrado não sorteia; o 6º pedido na hora vira rate-limited", async () => {
    for (let i = 0; i < 5; i++) {
      await esperarTipo(pedirSorteio(O3, G3.grupoId, 1), "permission-denied");
    }
    await esperarTipo(pedirSorteio(O3, G3.grupoId, 1), "rate-limited");
  });
});

/**
 * Faz a consulta de (1) pelo SDK cliente (`@instantdb/core`), logado como o usuário.
 * O core só liga fora do navegador se achar um `window`; o storage é em memória e
 * a rede é sempre "online". Tudo é desfeito ao final.
 */
async function paresComoCliente(u: Usuario) {
  const g = globalThis as Record<string, unknown>;
  const tinhaWindow = "window" in g;
  if (!tinhaWindow) g.window = globalThis;
  class Memoria {
    m = new Map<string, unknown>();
    constructor(_appId: string, _dbName: string) {}
    async getItem(k: string) {
      return this.m.get(k) ?? null;
    }
    async setItem(k: string, v: unknown) {
      this.m.set(k, v);
    }
    async getAllKeys() {
      return [...this.m.keys()];
    }
    async multiSet(kv: [string, unknown][]) {
      for (const [k, v] of kv) this.m.set(k, v);
    }
    async removeItem(k: string) {
      this.m.delete(k);
    }
  }
  const SempreOnline = { getIsOnline: async () => true, listen: () => () => {} };
  const db = initCliente(
    {
      appId: process.env.INSTANT_TEST_APP_ID!,
      apiURI: process.env.INSTANT_API_URI!,
      websocketURI: "wss://instant.tpou.gy/runtime/session",
      schema,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Memoria as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    SempreOnline as any,
  );
  try {
    const token = await admin.auth.createToken({ email: u.email });
    await db.auth.signInWithToken(token);
    const r = await db.queryOnce({ pares: { doador: {}, receptor: {} } });
    return r.data;
  } finally {
    db.shutdown();
    if (!tinhaWindow) delete g.window;
  }
}
