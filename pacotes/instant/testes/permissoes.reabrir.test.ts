// Suíte de permissões de reabertura do grupo (`reaberturas`, `grupos.rodadaBase`) e do limite
// de rodadas por abertura. Roda contra o app de TESTE (amigo-secreto-teste). Ver pacotes/instant/perms.ts.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { id } from "@instantdb/admin";
import { sendCommand } from "instant-commands/client";
import { sorteio } from "../commands";
import {
  adminTeste,
  criarGrupoTeste,
  criarUsuario,
  entrar,
  erroDe,
  limparTudo,
  novoPrefixo,
  pedirReabertura,
  simularReabertura,
  simularWorker,
  tipoErro,
  type Usuario,
} from "./instant-teste";

setDefaultTimeout(30_000);

const PREFIXO = novoPrefixo("perm-reabrir");
const admin = adminTeste();

let O: Usuario; // organizador de G (e participante)
let A: Usuario;
let B: Usuario;
let C: Usuario;
let R: Usuario; // retardatário
let estranho: Usuario;
let G: { grupoId: string; codigo: string };
let pO: string;
let pA: string;
let pB: string;
let pC: string;
let reabertura: string;

async function esperarTipo(p: Promise<unknown>, tipo: string) {
  const e = await erroDe(p);
  expect(tipoErro(e)).toBe(tipo);
}

async function pedirSorteio(u: Usuario, grupoId: string, rodada: number): Promise<string> {
  return sendCommand(u.db, sorteio, { rodada, chave: `${grupoId}:${rodada}`, grupo: grupoId });
}

/** Simula o fim de um sorteio sem pares (só o estado do grupo), para avançar a rodada. */
async function marcarSorteado(grupoId: string, rodadaAtual: number) {
  await admin.transact(admin.tx.grupos[grupoId]!.update({ status: "sorteado", rodadaAtual }));
}

beforeAll(async () => {
  [O, A, B, C, R, estranho] = await Promise.all(
    Array.from({ length: 6 }, () => criarUsuario(PREFIXO)),
  );
  G = await criarGrupoTeste(O);
  pO = await entrar(O, G.grupoId, G.codigo);
  pA = await entrar(A, G.grupoId, G.codigo);
  pB = await entrar(B, G.grupoId, G.codigo);
  pC = await entrar(C, G.grupoId, G.codigo);
  const s1 = await pedirSorteio(O, G.grupoId, 1);
  await simularWorker(admin, s1, [
    { doador: pA, receptor: pB },
    { doador: pB, receptor: pC },
    { doador: pC, receptor: pO },
    { doador: pO, receptor: pA },
  ]);
});

afterAll(async () => {
  await limparTudo(PREFIXO);
});

describe("criar reabertura", () => {
  test("1. participante (não organizador) não reabre", async () => {
    await esperarTipo(pedirReabertura(A, G.grupoId), "permission-denied");
  });

  test("2. não se reabre grupo aberto, encerrado ou com sorteio pending", async () => {
    // Organizador dedicado: o rateLimit (5/hora) é por usuário.
    const O2 = await criarUsuario(PREFIXO);
    const aberto = await criarGrupoTeste(O2, { organizadorParticipa: true });
    const encerrado = await criarGrupoTeste(O2, { organizadorParticipa: true, status: "encerrado" });
    const comPendente = await criarGrupoTeste(O2, { organizadorParticipa: true });
    await pedirSorteio(O2, comPendente.grupoId, 1);
    await marcarSorteado(comPendente.grupoId, 0);
    for (const g of [aberto, encerrado, comPendente]) {
      await esperarTipo(pedirReabertura(O2, g.grupoId), "permission-denied");
    }
    const { reaberturas } = await admin.query({
      reaberturas: {
        $: { where: { "grupo.id": { $in: [aberto.grupoId, encerrado.grupoId, comPendente.grupoId] } } },
      },
    });
    expect(reaberturas).toEqual([]);
  });

  test("create direto com status done → permission-denied; sendCommand grava pending", async () => {
    await esperarTipo(
      O.db.transact(
        O.db.tx.reaberturas[id()]!
          .create({ status: "done", attempts: 0, createdAt: Date.now() })
          .link({ grupo: G.grupoId }),
      ),
      "permission-denied",
    );
  });

  test("3. organizador reabre o grupo sorteado; membro vê, estranho não", async () => {
    reabertura = await pedirReabertura(O, G.grupoId);
    const a = await A.db.query({ reaberturas: {} });
    expect(a.reaberturas.map((r) => r.id)).toEqual([reabertura]);
    expect(a.reaberturas[0]!.status).toBe("pending");
    const o = await O.db.query({ grupos: { $: { where: { id: G.grupoId } }, reaberturas: {} } });
    expect(o.grupos[0]!.reaberturas.map((r) => r.id)).toEqual([reabertura]);
    const e = await estranho.db.query({ reaberturas: {} });
    expect(e.reaberturas).toEqual([]);
  });

  // ACHADO: o brief pedia "nem O apaga", mas o servidor checa `delete` nos filhos apagados em
  // cascata (no estado anterior); com `delete: false` o organizador não apaga mais o grupo depois
  // de reabrir (ver "apagar grupo com reabertura"). Fica como em sorteios: O pode apagar.
  test("4. ninguém faz update ou unlink de reabertura; só o organizador apagaria", async () => {
    for (const u of [O, A]) {
      for (const passo of [
        u.db.tx.reaberturas[reabertura]!.update({ status: "done" }),
        u.db.tx.reaberturas[reabertura]!.unlink({ grupo: G.grupoId }),
        u.db.tx.grupos[G.grupoId]!.unlink({ reaberturas: reabertura }),
      ]) {
        await esperarTipo(u.db.transact(passo), "permission-denied");
      }
    }
    for (const u of [A, estranho]) {
      await esperarTipo(u.db.transact(u.db.tx.reaberturas[reabertura]!.delete()), "permission-denied");
    }
    const { reaberturas } = await admin.query({
      reaberturas: { $: { where: { id: reabertura } }, grupo: {} },
    });
    expect(reaberturas[0]!.status).toBe("pending");
    expect(reaberturas[0]!.grupo?.id).toBe(G.grupoId);
  });

  test("não se liga reabertura existente a outro grupo", async () => {
    const outro = await criarGrupoTeste(O);
    await esperarTipo(
      O.db.transact(O.db.tx.reaberturas[reabertura]!.link({ grupo: outro.grupoId })),
      "permission-denied",
    );
    await esperarTipo(
      O.db.transact(O.db.tx.grupos[outro.grupoId]!.link({ reaberturas: reabertura })),
      "permission-denied",
    );
  });

  test("5. com a reabertura pending (grupo ainda sorteado), o retardatário não entra", async () => {
    await esperarTipo(entrar(R, G.grupoId, G.codigo), "permission-denied");
  });

  test("com a reabertura pending, o organizador não pede sorteio (refazer)", async () => {
    await esperarTipo(pedirSorteio(O, G.grupoId, 2), "permission-denied");
    const { sorteios } = await admin.query({ sorteios: { $: { where: { "grupo.id": G.grupoId } } } });
    expect(sorteios).toHaveLength(1);
  });
});

describe("depois de reabrir", () => {
  beforeAll(async () => {
    await simularReabertura(admin, G.grupoId);
  });

  test("estado depois do worker (sanidade, via admin)", async () => {
    const r = await admin.query({
      grupos: { $: { where: { id: G.grupoId } } },
      reaberturas: { $: { where: { id: reabertura } } },
    });
    expect(r.grupos[0]!.status).toBe("aberto");
    expect(r.grupos[0]!.rodadaAtual).toBe(1);
    expect(r.grupos[0]!.rodadaBase).toBe(1);
    expect(r.reaberturas[0]!.status).toBe("done");
  });

  test("6. o retardatário entra; ninguém vê pares", async () => {
    await entrar(R, G.grupoId, G.codigo);
    for (const u of [A, O, R]) {
      const r = await u.db.query({ pares: {} });
      expect(r.pares).toEqual([]);
    }
  });

  test("7. rodadaBase 1: a rodada 2 é aceita; a 4 também; a 5 é recusada", async () => {
    await pedirSorteio(O, G.grupoId, 2);
    await marcarSorteado(G.grupoId, 3);
    await pedirSorteio(O, G.grupoId, 4);
    await marcarSorteado(G.grupoId, 4);
    await esperarTipo(pedirSorteio(O, G.grupoId, 5), "permission-denied");
  });

  test("9. organizador não grava rodadaBase (update nem create)", async () => {
    await esperarTipo(
      O.db.transact(O.db.tx.grupos[G.grupoId]!.update({ rodadaBase: 50 })),
      "permission-denied",
    );
    await esperarTipo(
      O.db.transact(
        O.db.tx.grupos[id()]!
          .create({
            titulo: `Grupo de ${O.email}`,
            tema: "livro",
            codigo: `X${Date.now().toString(36)}`,
            status: "aberto",
            rodadaAtual: 0,
            rodadaBase: 50,
            criadoEm: Date.now(),
          })
          .link({ organizador: O.id }),
      ),
      "permission-denied",
    );
    const { grupos } = await admin.query({ grupos: { $: { where: { id: G.grupoId } } } });
    expect(grupos[0]!.rodadaBase).toBe(1);
  });
});

describe("limites", () => {
  test("8. grupo sem rodadaBase (legado): rodadas 1 a 3 aceitas, a 4 recusada", async () => {
    const O3 = await criarUsuario(PREFIXO);
    const L = await criarGrupoTeste(O3, { organizadorParticipa: true });
    const { grupos } = await admin.query({ grupos: { $: { where: { id: L.grupoId } } } });
    expect(grupos[0]!.rodadaBase ?? null).toBeNull();
    await pedirSorteio(O3, L.grupoId, 1);
    await marcarSorteado(L.grupoId, 1);
    await pedirSorteio(O3, L.grupoId, 2);
    await marcarSorteado(L.grupoId, 2);
    await pedirSorteio(O3, L.grupoId, 3);
    await marcarSorteado(L.grupoId, 3);
    await esperarTipo(pedirSorteio(O3, L.grupoId, 4), "permission-denied");
  });

  test("10. a 6ª reabertura de um organizador na hora vira rate-limited", async () => {
    const O4 = await criarUsuario(PREFIXO);
    const S = await criarGrupoTeste(O4, { organizadorParticipa: true, status: "sorteado" });
    for (let i = 0; i < 5; i++) await pedirReabertura(O4, S.grupoId);
    await esperarTipo(pedirReabertura(O4, S.grupoId), "rate-limited");
    const { reaberturas } = await admin.query({ reaberturas: { $: { where: { "grupo.id": S.grupoId } } } });
    expect(reaberturas).toHaveLength(5);
  });
});

describe("apagar grupo com reabertura", () => {
  test("organizador apaga o grupo; a reabertura vai junto", async () => {
    const O5 = await criarUsuario(PREFIXO);
    const S = await criarGrupoTeste(O5, { organizadorParticipa: true, status: "sorteado" });
    const r = await pedirReabertura(O5, S.grupoId);
    await O5.db.transact(O5.db.tx.grupos[S.grupoId]!.delete());
    const q = await admin.query({
      grupos: { $: { where: { id: S.grupoId } } },
      reaberturas: { $: { where: { id: r } } },
    });
    expect(q.grupos).toEqual([]);
    expect(q.reaberturas).toEqual([]);
  });
});
