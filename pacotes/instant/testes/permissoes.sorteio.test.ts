// Suíte de permissões de sorteios e pares (e o efeito do sorteio sobre respostas).
// Roda contra o app de TESTE (amigo-secreto-teste). Ver pacotes/instant/perms.ts.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { id } from "@instantdb/admin";
import { sendCommand } from "instant-commands/client";
import { sorteio } from "../commands";
import {
  adminTeste,
  comoCliente,
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
  return sendCommand(u.db, sorteio, { rodada, chave, grupo: grupoId });
}

/** Como admin, marca o sorteio como failed e libera a chave (ruling do worker). */
async function marcarErro(grupoId: string, sorteioId: string, rodada: number) {
  await admin.transact(
    admin.tx.sorteios[sorteioId]!.update({
      status: "failed",
      error: "teste",
      attempts: 1,
      finishedAt: Date.now(),
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
    expect(r.sorteios[0]!.status).toBe("done");
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
      A.db.transact(A.db.tx.sorteios[sorteio1]!.update({ status: "pending" })),
      "permission-denied",
    );
    // Nem o organizador mexe no sorteio.
    await esperarTipo(
      O.db.transact(O.db.tx.sorteios[sorteio1]!.update({ status: "failed" })),
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

// Filtros `where` atravessando links: o filtro não pode revelar o que a regra esconde.
// Estado: A→B, B→C, C→O, O→A. Sondam O (organizador, tirou A) e C (membro, tirou O);
// nenhum dos dois tirou B nem vê o par A→B.
describe("where por links não vaza pares nem respostas", () => {
  const sondas = () => [
    ["O (organizador)", O],
    ["C (membro)", C],
  ] as const;

  test("participantes where recebidoDe.doador.id = pA → []", async () => {
    for (const [, u] of sondas()) {
      const r = await u.db.query({ participantes: { $: { where: { "recebidoDe.doador.id": pA } } } });
      expect(r.participantes).toEqual([]);
    }
  });

  test("participantes where doando.receptor.id = pB → []", async () => {
    for (const [, u] of sondas()) {
      const r = await u.db.query({ participantes: { $: { where: { "doando.receptor.id": pB } } } });
      expect(r.participantes).toEqual([]);
    }
  });

  test("participantes where respostas.valor = resposta de B → []", async () => {
    for (const [, u] of sondas()) {
      const r = await u.db.query({
        participantes: { $: { where: { "respostas.valor": `resposta de ${pB}` } } },
      });
      expect(r.participantes).toEqual([]);
    }
  });

  test("respostas where valor = resposta de B → []", async () => {
    for (const [, u] of sondas()) {
      const r = await u.db.query({ respostas: { $: { where: { valor: `resposta de ${pB}` } } } });
      expect(r.respostas).toEqual([]);
    }
  });

  test("controle: o admin acha as mesmas linhas (os filtros funcionam)", async () => {
    const q1 = await admin.query({ participantes: { $: { where: { "recebidoDe.doador.id": pA } } } });
    const q2 = await admin.query({ participantes: { $: { where: { "doando.receptor.id": pB } } } });
    const q3 = await admin.query({ participantes: { $: { where: { "respostas.valor": `resposta de ${pB}` } } } });
    const q4 = await admin.query({ respostas: { $: { where: { valor: `resposta de ${pB}` } } } });
    expect(q1.participantes.map((p) => p.id)).toEqual([pB]);
    expect(q2.participantes.map((p) => p.id)).toEqual([pA]);
    expect(q3.participantes.map((p) => p.id)).toEqual([pB]);
    expect(q4.respostas.map((x) => x.id)).toEqual([resposta[pB]!]);
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
    expect(sorteios.find((s) => s.id === s2)!.status).toBe("pending");
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

  test("sorteio nasce pending: create direto com outro status → permission-denied", async () => {
    const sorteioId = id();
    await esperarTipo(
      O4.db.transact(
        O4.db.tx.sorteios[sorteioId]!
          .create({ status: "done", attempts: 0, rodada: 1, chave: `${G4.grupoId}:1`, createdAt: Date.now() })
          .link({ grupo: G4.grupoId }),
      ),
      "permission-denied",
    );
    // O sendCommand grava `pending` e passa.
    const s = await pedirSorteio(O4, G4.grupoId, 1);
    const { sorteios } = await admin.query({ sorteios: { $: { where: { id: s } } } });
    expect(sorteios[0]!.status).toBe("pending");
  });

  test("grupo encerrado não sorteia; o 6º pedido na hora vira rate-limited", async () => {
    for (let i = 0; i < 5; i++) {
      await esperarTipo(pedirSorteio(O3, G3.grupoId, 1), "permission-denied");
    }
    await esperarTipo(pedirSorteio(O3, G3.grupoId, 1), "rate-limited");
  });
});

describe("entrada no grupo com sorteio em andamento", () => {
  test("pending/running bloqueiam a entrada; depois do erro, entra", async () => {
    const [O5, D1, D2, D3] = await Promise.all([1, 2, 3, 4].map(() => criarUsuario(PREFIXO)));
    const G5 = await criarGrupoTeste(O5!, { organizadorParticipa: true });
    await entrar(D1!, G5.grupoId, G5.codigo);
    // Sem sorteio, entrar funciona (controle).
    const s = await pedirSorteio(O5!, G5.grupoId, 1);
    await esperarTipo(entrar(D2!, G5.grupoId, G5.codigo), "permission-denied");
    await admin.transact(admin.tx.sorteios[s]!.update({ status: "running", attempts: 1 }));
    await esperarTipo(entrar(D3!, G5.grupoId, G5.codigo), "permission-denied");
    // Erro (chave liberada): a porta reabre.
    await marcarErro(G5.grupoId, s, 1);
    await entrar(D2!, G5.grupoId, G5.codigo);
    const { participantes } = await admin.query({
      participantes: { $: { where: { "grupo.id": G5.grupoId } } },
    });
    expect(participantes).toHaveLength(3);
  });
});

/** Teste 11: os pares vistos pelo SDK cliente (`@instantdb/core`), não pelo admin. */
async function paresComoCliente(u: Usuario) {
  return comoCliente(u, async (db) => (await db.queryOnce({ pares: { doador: {}, receptor: {} } })).data);
}
