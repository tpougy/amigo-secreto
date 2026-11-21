// Integração do workflow `reabrir-grupo` (e do limite de rodadas por abertura no `sortear`):
// app de TESTE do Instant + worker real do OpenWorkflow (SQLite num arquivo temporário,
// concorrência 1).
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { id } from "@instantdb/admin";
import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";
import {
  adminTeste,
  adminTesteSemSchema,
  criarGrupoTeste,
  criarUsuario,
  entrar,
  limparTudo,
  novoPrefixo,
  pedirReabertura,
  type Usuario,
} from "../../testes/instant-teste";
import {
  carregarReabertura,
  definirReabrirGrupo,
  MSG_GRUPO_NAO_EXISTE,
  MSG_GRUPO_NAO_SORTEADO,
  MSG_SORTEIO_EM_ANDAMENTO,
  processarReaberturas,
  reabrir,
} from "./reabrirGrupo";
import { carregar, definirSorteio, MSG_RODADA_INVALIDA, processarPendentes, rodadaValida } from "./sortear";

setDefaultTimeout(60_000);

const PREFIXO = novoPrefixo("worker-reabrir");
const admin = adminTeste();
const DIR = process.env.OW_TESTE_DIR ?? tmpdir();
const OW_DB = join(DIR, `ow-teste-${PREFIXO}.db`);
/** Segredo da seed só para os testes (em produção: `dokku config` do amigo-worker). */
const SEGREDO_TESTE = "0123456789abcdef".repeat(4);
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

function apagarOwDb() {
  for (const suf of ["", "-wal", "-shm"]) rmSync(OW_DB + suf, { force: true });
}

async function montar() {
  const backend = BackendSqlite.connect(OW_DB);
  const ow = new OpenWorkflow({ backend });
  const wfSortear = definirSorteio(ow, admin, { segredo: SEGREDO_TESTE });
  const wf = definirReabrirGrupo(ow, admin);
  const worker = ow.newWorker({ concurrency: 1 });
  await worker.start();
  return {
    ow,
    wf,
    wfSortear,
    async parar() {
      await worker.stop();
      await backend.stop();
    },
  };
}

function runsDaChave(chave: string): { id: string; status: string }[] {
  const db = new Database(OW_DB, { readonly: true });
  try {
    return db.query("select id, status from workflow_runs where idempotency_key = ?").all(chave) as {
      id: string;
      status: string;
    }[];
  } finally {
    db.close();
  }
}

let amb: Awaited<ReturnType<typeof montar>>;
let campainhas: { parar(): void }[] = [];

function ligarCampainhas(reaberturas = true) {
  desligarCampainhas();
  campainhas = [processarPendentes(amb.ow, admin)];
  if (reaberturas) campainhas.push(processarReaberturas(amb.ow, admin));
}
function desligarCampainhas() {
  for (const c of campainhas) c.parar();
  campainhas = [];
}

beforeAll(async () => {
  apagarOwDb();
  amb = await montar();
  ligarCampainhas();
});

afterAll(async () => {
  desligarCampainhas();
  await amb?.parar();
  apagarOwDb();
  await limparTudo(PREFIXO);
  const semSchema = adminTesteSemSchema();
  const { $streams } = await semSchema.query({ $streams: { $: { where: { clientId: { $like: "sorteio-%" } } } } });
  if ($streams.length) await semSchema.transact($streams.map((s) => semSchema.tx.$streams[s.id]!.delete()));
});

type Grupo = { grupoId: string; codigo: string; org: Usuario; usuarios: Usuario[]; participantes: string[] };

async function grupoCom(n: number): Promise<Grupo> {
  const org = await criarUsuario(PREFIXO);
  const g = await criarGrupoTeste(org);
  const usuarios = [org];
  const participantes = [await entrar(org, g.grupoId, g.codigo)];
  for (let i = 1; i < n; i++) {
    const u = await criarUsuario(PREFIXO);
    usuarios.push(u);
    participantes.push(await entrar(u, g.grupoId, g.codigo));
  }
  return { grupoId: g.grupoId, codigo: g.codigo, org, usuarios, participantes };
}

async function pedirSorteio(g: Grupo, rodada: number): Promise<string> {
  const sorteioId = id();
  await g.org.db.transact(
    g.org.db.tx.sorteios[sorteioId]!
      .create({ status: "pendente", rodada, chave: `${g.grupoId}:${rodada}`, criadoEm: Date.now() })
      .link({ grupo: g.grupoId }),
  );
  return sorteioId;
}

async function esperar<T>(ler: () => Promise<T | undefined>, ok: (v: T) => boolean, prazoMs = 15_000): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < prazoMs) {
    const v = await ler();
    if (v !== undefined && ok(v)) return v;
    await dormir(200);
  }
  throw new Error("prazo estourado");
}

const lerSorteio = async (sorteioId: string) =>
  (await admin.query({ sorteios: { $: { where: { id: sorteioId } }, pares: {} } })).sorteios[0];
const lerReabertura = async (reaberturaId: string) =>
  (await admin.query({ reaberturas: { $: { where: { id: reaberturaId } } } })).reaberturas[0];
const lerGrupo = async (grupoId: string) =>
  (await admin.query({ grupos: { $: { where: { id: grupoId } } } })).grupos[0];
const paresDoGrupo = async (grupoId: string) =>
  (await admin.query({ pares: { $: { where: { "sorteio.grupo.id": grupoId } } } })).pares;

const esperarSorteio = (sorteioId: string) =>
  esperar(() => lerSorteio(sorteioId), (s) => s.status !== "pendente" && s.status !== "processando");
const esperarReabertura = (reaberturaId: string) =>
  esperar(() => lerReabertura(reaberturaId), (r) => r.status !== "pendente");

/** Grupo de `n` participantes já sorteado na rodada 1 pelo workflow real. */
async function grupoSorteado(n: number): Promise<Grupo> {
  const g = await grupoCom(n);
  const s = await esperarSorteio(await pedirSorteio(g, 1));
  expect(s.status).toBe("concluido");
  return g;
}

describe("workflow reabrir-grupo", () => {
  let G: Grupo;
  let reabertura1: string;
  let paresRodada2: string[];

  test("1. grupo sorteado com 4: reabrir apaga os pares, abre o grupo e grava rodadaBase", async () => {
    G = await grupoSorteado(4);
    expect(await paresDoGrupo(G.grupoId)).toHaveLength(4);
    reabertura1 = await pedirReabertura(G.org, G.grupoId);
    const r = await esperarReabertura(reabertura1);
    expect(r.status).toBe("concluido");
    expect(r.erro ?? null).toBeNull();
    expect(await paresDoGrupo(G.grupoId)).toHaveLength(0);
    const g = (await lerGrupo(G.grupoId))!;
    expect(g.status).toBe("aberto");
    expect(g.rodadaAtual).toBe(1);
    expect(g.rodadaBase).toBe(1);
  });

  test("2. ciclo completo: R entra, sorteio da rodada 2 com 5, cada um vê exatamente 1", async () => {
    const R = await criarUsuario(PREFIXO);
    G.usuarios.push(R);
    G.participantes.push(await entrar(R, G.grupoId, G.codigo));
    const s = await esperarSorteio(await pedirSorteio(G, 2));
    expect(s.status).toBe("concluido");
    expect(s.pares).toHaveLength(5);
    paresRodada2 = s.pares.map((p) => p.id).sort();
    for (let i = 0; i < 5; i++) {
      const r = await G.usuarios[i]!.db.query({ pares: { doador: {} } });
      expect(r.pares).toHaveLength(1);
      expect(r.pares[0]!.doador?.id).toBe(G.participantes[i]!);
    }
    const g = (await lerGrupo(G.grupoId))!;
    expect(g.status).toBe("sorteado");
    expect(g.rodadaAtual).toBe(2);
    expect(g.rodadaBase).toBe(1);
  });

  test("3. duas reaberturas seguidas: uma conclui, a outra vira erro sem apagar nada a mais", async () => {
    const G2 = await grupoSorteado(3);
    const [a, b] = [id(), id()];
    // Dois cliques: as duas são criadas enquanto o grupo ainda está sorteado.
    await G2.org.db.transact(
      [a, b].map((r) =>
        G2.org.db.tx.reaberturas[r]!.create({ status: "pendente", criadoEm: Date.now() }).link({ grupo: G2.grupoId }),
      ),
    );
    const ra = await esperarReabertura(a);
    const rb = await esperarReabertura(b);
    const status = [ra, rb].map((r) => `${r.status}:${r.erro ?? ""}`).sort();
    expect(status).toEqual(["concluido:", `erro:${MSG_GRUPO_NAO_SORTEADO}`]);

    // Novo sorteio (rodada 2); reprocessar as duas reaberturas não toca nos pares novos.
    const s = await esperarSorteio(await pedirSorteio(G2, 2));
    expect(s.status).toBe("concluido");
    const novos = s.pares.map((p) => p.id).sort();
    for (const r of [a, b]) {
      const h = await amb.wf.run({ reaberturaId: r }, { idempotencyKey: `${r}:de-novo` });
      expect(await h.result({ timeoutMs: 15_000 })).toEqual({ ignorado: true });
    }
    expect((await paresDoGrupo(G2.grupoId)).map((p) => p.id).sort()).toEqual(novos);
    expect((await lerGrupo(G2.grupoId))!.status).toBe("sorteado");
  });

  test("4. a mesma reabertura disparada de novo, ou com o ow.db apagado, não muda nada", async () => {
    const h1 = await amb.wf.run({ reaberturaId: reabertura1 }, { idempotencyKey: reabertura1 });
    const h2 = await amb.wf.run({ reaberturaId: reabertura1 }, { idempotencyKey: reabertura1 });
    expect(h2.workflowRun.id).toBe(h1.workflowRun.id);
    expect(runsDaChave(reabertura1)).toHaveLength(1);

    desligarCampainhas();
    await amb.parar();
    apagarOwDb();
    amb = await montar();
    expect(runsDaChave(reabertura1)).toHaveLength(0);
    const h = await amb.wf.run({ reaberturaId: reabertura1 }, { idempotencyKey: reabertura1 });
    expect(await h.result({ timeoutMs: 15_000 })).toEqual({ ignorado: true });
    expect((await paresDoGrupo(G.grupoId)).map((p) => p.id).sort()).toEqual(paresRodada2);
    const g = (await lerGrupo(G.grupoId))!;
    expect(g.status).toBe("sorteado");
    expect(g.rodadaAtual).toBe(2);
    expect(g.rodadaBase).toBe(1);
  });
});

// Daqui em diante, sem a campainha de reaberturas: os testes controlam quando cada passo roda.
describe("reabrir-grupo: estado mudou no meio (Review Focus 5)", () => {
  beforeAll(() => ligarCampainhas(false));

  test("5a. grupo apagado antes do passo reabrir: nenhum grupo nem reabertura fantasma", async () => {
    const g = await grupoSorteado(3);
    const r = await pedirReabertura(g.org, g.grupoId);
    expect(await carregarReabertura(admin, r)).toEqual({ pendente: true });
    await g.org.db.transact(g.org.db.tx.grupos[g.grupoId]!.delete());
    expect(await reabrir(admin, r)).toEqual({ ignorado: true });
    // E o workflow inteiro também.
    const h = await amb.wf.run({ reaberturaId: r }, { idempotencyKey: r });
    expect(await h.result({ timeoutMs: 15_000 })).toEqual({ ignorado: true });
    const q = await admin.query({
      grupos: { $: { where: { id: g.grupoId } } },
      reaberturas: { $: { where: { id: r } } },
    });
    expect(q.grupos).toEqual([]);
    expect(q.reaberturas).toEqual([]);
  });

  test("5f. duplo clique com a 2ª presa: concluir a 1ª encerra a 2ª, que não desfaz o sorteio novo", async () => {
    const g = await grupoSorteado(3);
    const [a, b] = [id(), id()];
    await g.org.db.transact(
      [a, b].map((r) =>
        g.org.db.tx.reaberturas[r]!.create({ status: "pendente", criadoEm: Date.now() }).link({ grupo: g.grupoId }),
      ),
    );
    expect(await reabrir(admin, a)).toEqual({ pares: 3 });
    const rb = (await lerReabertura(b))!;
    expect(rb.status).toBe("erro");
    expect(rb.erro).toBe(MSG_GRUPO_NAO_SORTEADO);
    const s = await esperarSorteio(await pedirSorteio(g, 2));
    expect(s.status).toBe("concluido");
    const novos = s.pares.map((p) => p.id).sort();
    expect(await reabrir(admin, b)).toEqual({ ignorado: true });
    const h = await amb.wf.run({ reaberturaId: b }, { idempotencyKey: b });
    expect(await h.result({ timeoutMs: 15_000 })).toEqual({ ignorado: true });
    expect((await paresDoGrupo(g.grupoId)).map((p) => p.id).sort()).toEqual(novos);
    expect((await lerGrupo(g.grupoId))!.status).toBe("sorteado");
  });

  test("5b. organizador apaga a reabertura pendente antes do passo: sem fantasma, grupo intocado", async () => {
    const g = await grupoSorteado(3);
    const r = await pedirReabertura(g.org, g.grupoId);
    expect(await carregarReabertura(admin, r)).toEqual({ pendente: true });
    await g.org.db.transact(g.org.db.tx.reaberturas[r]!.delete());
    expect(await reabrir(admin, r)).toEqual({ ignorado: true });
    expect(await lerReabertura(r)).toBeUndefined();
    expect((await lerGrupo(g.grupoId))!.status).toBe("sorteado");
    expect(await paresDoGrupo(g.grupoId)).toHaveLength(3);
  });

  test("5c. grupo encerrado: reabertura vira erro e o grupo continua encerrado", async () => {
    const g = await grupoSorteado(3);
    const r = await pedirReabertura(g.org, g.grupoId);
    await admin.transact(admin.tx.grupos[g.grupoId]!.update({ status: "encerrado" }));
    const h = await amb.wf.run({ reaberturaId: r }, { idempotencyKey: r });
    expect(await h.result({ timeoutMs: 15_000 })).toEqual({ erro: MSG_GRUPO_NAO_SORTEADO });
    const reab = (await lerReabertura(r))!;
    expect(reab.status).toBe("erro");
    expect(reab.erro).toBe(MSG_GRUPO_NAO_SORTEADO);
    expect((await lerGrupo(g.grupoId))!.status).toBe("encerrado");
    expect(await paresDoGrupo(g.grupoId)).toHaveLength(3);
  });

  test("5d. sorteio em andamento: reabertura vira erro, pares intocados", async () => {
    const g = await grupoSorteado(3);
    const r = await pedirReabertura(g.org, g.grupoId);
    desligarCampainhas(); // o sorteio tem de continuar pendente
    // Pedido pelo admin: a regra já recusa o organizador com reabertura pendente.
    const sorteioId = id();
    await admin.transact(
      admin.tx.sorteios[sorteioId]!
        .create({ status: "pendente", rodada: 2, chave: `${g.grupoId}:2`, criadoEm: Date.now() })
        .link({ grupo: g.grupoId }),
    );
    expect(await reabrir(admin, r)).toEqual({ erro: MSG_SORTEIO_EM_ANDAMENTO });
    expect((await lerReabertura(r))!.erro).toBe(MSG_SORTEIO_EM_ANDAMENTO);
    expect(await paresDoGrupo(g.grupoId)).toHaveLength(3);
    expect((await lerGrupo(g.grupoId))!.status).toBe("sorteado");
    await admin.transact(admin.tx.sorteios[sorteioId]!.delete());
    ligarCampainhas(false);
  });

  test("5e. reabertura sem grupo ligado: erro 'O grupo não existe mais', sem grupo fantasma", async () => {
    const g = await grupoSorteado(3);
    const r = await pedirReabertura(g.org, g.grupoId);
    await admin.transact(admin.tx.reaberturas[r]!.unlink({ grupo: g.grupoId }));
    expect(await reabrir(admin, r)).toEqual({ erro: MSG_GRUPO_NAO_EXISTE });
    expect((await lerReabertura(r))!.status).toBe("erro");
    expect((await lerGrupo(g.grupoId))!.status).toBe("sorteado");
    expect(await paresDoGrupo(g.grupoId)).toHaveLength(3);
    await admin.transact(admin.tx.reaberturas[r]!.delete());
  });
});

describe("sortear: limite de rodadas por abertura (Review Focus 3)", () => {
  beforeAll(() => desligarCampainhas()); // `carregar` é chamado direto
  test("rodadaValida: rodadaBase ausente vale 0", () => {
    expect(rodadaValida(1, 0, undefined)).toBe(true);
    expect(rodadaValida(3, 2, undefined)).toBe(true);
    expect(rodadaValida(4, 3, undefined)).toBe(false);
    expect(rodadaValida(4, 3, null)).toBe(false);
    expect(rodadaValida(4, 3, 1)).toBe(true);
    expect(rodadaValida(5, 4, 1)).toBe(false);
    expect(rodadaValida(3, 1, 1)).toBe(false); // fora de sequência
  });

  test("worker: rodada 4 sem rodadaBase é inválida; com rodadaBase 1 passa", async () => {
    const g = await grupoCom(3);
    await admin.transact(admin.tx.grupos[g.grupoId]!.update({ status: "sorteado", rodadaAtual: 3 }));
    const criar = async () => {
      const sorteioId = id();
      await admin.transact(
        admin.tx.sorteios[sorteioId]!
          .create({ status: "pendente", rodada: 4, chave: `${g.grupoId}:4`, criadoEm: Date.now() })
          .link({ grupo: g.grupoId }),
      );
      return sorteioId;
    };
    const s1 = await criar();
    expect(await carregar(admin, s1)).toEqual({ erro: MSG_RODADA_INVALIDA });
    expect((await lerSorteio(s1))!.status).toBe("erro");

    await admin.transact(admin.tx.grupos[g.grupoId]!.update({ rodadaBase: 1 }));
    const s2 = await criar(); // a chave `<grupo>:4` foi liberada pelo erro
    const carga = await carregar(admin, s2);
    expect("participantes" in carga && carga.participantes).toHaveLength(3);
    await admin.transact(admin.tx.sorteios[s2]!.delete());
  });
});
