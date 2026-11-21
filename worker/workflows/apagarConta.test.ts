// Integração do workflow `apagar-conta`: app de TESTE do Instant + worker real do OpenWorkflow
// (SQLite num arquivo temporário, concorrência 1).
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { id } from "@instantdb/admin";
import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";
import { APELIDO_REMOVIDO, caminhoCapa } from "@amigo/dominio";
import {
  adminTeste,
  criarGrupoTeste,
  criarUsuario,
  entrar,
  limparTudo,
  novoPrefixo,
  simularWorker,
  type Usuario,
} from "@amigo/instant/teste";
import { dispararComRetomada } from "../nucleo/disparar";
import { definirApagarConta, limparDados, processarPedidosExclusao, specApagarConta } from "./apagarConta";
import { reabrir } from "./reabrirGrupo";
import type { AdminDb } from "./sortear";

setDefaultTimeout(60_000);

const PREFIXO = novoPrefixo("worker-conta");
const admin = adminTeste();
const DIR = process.env.OW_TESTE_DIR ?? tmpdir();
const OW_DB = join(DIR, `ow-teste-${PREFIXO}.db`);
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

function apagarOwDb() {
  for (const suf of ["", "-wal", "-shm"]) rmSync(OW_DB + suf, { force: true });
}

let ow: OpenWorkflow;
let backend: ReturnType<typeof BackendSqlite.connect>;
let worker: ReturnType<OpenWorkflow["newWorker"]>;
let campainha: { parar(): void };
const pedidos: string[] = [];

beforeAll(async () => {
  apagarOwDb();
  backend = BackendSqlite.connect(OW_DB);
  ow = new OpenWorkflow({ backend });
  definirApagarConta(ow, admin);
  worker = ow.newWorker({ concurrency: 1 });
  await worker.start();
  campainha = processarPedidosExclusao(ow, admin);
});

afterAll(async () => {
  campainha?.parar();
  await worker?.stop();
  await backend?.stop();
  apagarOwDb();
  if (pedidos.length) await admin.transact(pedidos.map((p) => admin.tx.pedidosExclusao[p]!.delete()));
  await limparTudo(PREFIXO);
});

/** A pessoa pede para apagar a conta (como o botão em /conta). */
async function pedirExclusao(u: Usuario): Promise<string> {
  const pedidoId = id();
  pedidos.push(pedidoId);
  await u.db.transact(
    u.db.tx.pedidosExclusao[pedidoId]!.create({ criadoEm: Date.now(), status: "pendente" }).link({ usuario: u.id }),
  );
  return pedidoId;
}

/** Espera o pedido `concluido` e o `$users` apagado (o último passo vem depois de concluir). */
async function esperarConcluido(pedidoId: string, usuarioId: string, prazoMs = 15_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < prazoMs) {
    const r = await admin.query({
      pedidosExclusao: { $: { where: { id: pedidoId } } },
      $users: { $: { where: { id: usuarioId } } },
    });
    if (r.pedidosExclusao[0]?.status === "concluido" && r.$users.length === 0) return Date.now() - t0;
    await dormir(200);
  }
  throw new Error("pedido não concluiu");
}

async function responder(u: Usuario, participanteId: string, grupoId: string): Promise<string> {
  const { campos } = await admin.query({ campos: { $: { where: { "grupo.id": grupoId } } } });
  const respostaId = id();
  await u.db.transact(
    u.db.tx.respostas[respostaId]!
      .create({ valor: "segredo", chave: `${participanteId}:${campos[0]!.id}` })
      .link({ participante: participanteId, campo: campos[0]!.id }),
  );
  return respostaId;
}

describe("workflow apagar-conta", () => {
  let X: Usuario; // quem apaga a conta
  let O: Usuario; // organiza o grupo sorteado
  let Y: Usuario;
  let Z: Usuario;
  let gSorteado: string;
  let gAberto: string;
  let gDeX: string;
  let pX: string; // participação de X no grupo sorteado
  let pXAberto: string;
  let gReaberto: string;
  let pXReaberto: string;
  let rXReaberto: string;
  let pYNoDeX: string;
  let rX: string;
  let rXAberto: string;
  let pedido: string;

  beforeAll(async () => {
    [X, O, Y, Z] = await Promise.all([1, 2, 3, 4].map(() => criarUsuario(PREFIXO)));

    // Grupo sorteado (O organiza e participa): O, X, Y, Z. X respondeu o perfil.
    const g1 = await criarGrupoTeste(O, { organizadorParticipa: true });
    gSorteado = g1.grupoId;
    pX = await entrar(X, gSorteado, g1.codigo);
    const pY = await entrar(Y, gSorteado, g1.codigo);
    const pZ = await entrar(Z, gSorteado, g1.codigo);
    rX = await responder(X, pX, gSorteado);
    const { participantes } = await admin.query({ participantes: { $: { where: { chave: `${gSorteado}:${O.id}` } } } });
    const pO = participantes[0]!.id;
    const sorteioId = id();
    await O.db.transact(
      O.db.tx.sorteios[sorteioId]!
        .create({ status: "pendente", rodada: 1, chave: `${gSorteado}:1`, criadoEm: Date.now() })
        .link({ grupo: gSorteado }),
    );
    await simularWorker(admin, sorteioId, [
      { doador: pO, receptor: pX },
      { doador: pX, receptor: pY },
      { doador: pY, receptor: pZ },
      { doador: pZ, receptor: pO },
    ]);

    // Grupo aberto de outra pessoa (Y organiza): X entrou e respondeu.
    const g2 = await criarGrupoTeste(Y);
    gAberto = g2.grupoId;
    pXAberto = await entrar(X, gAberto, g2.codigo);
    rXAberto = await responder(X, pXAberto, gAberto);

    // Grupo que X organiza, com capa e com Y participando.
    const g3 = await criarGrupoTeste(X, { organizadorParticipa: true });
    gDeX = g3.grupoId;
    pYNoDeX = await entrar(Y, gDeX, g3.codigo);
    const up = await admin.storage.uploadFile(caminhoCapa(gDeX), Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
      contentType: "image/jpeg",
    });
    await admin.transact(admin.tx.grupos[gDeX]!.link({ capa: up.data.id }));

    // Grupo sorteado e depois reaberto (Z organiza e participa): aberto, rodadaAtual 1, sem pares.
    const g4 = await criarGrupoTeste(Z, { organizadorParticipa: true });
    gReaberto = g4.grupoId;
    pXReaberto = await entrar(X, gReaberto, g4.codigo);
    const pYReaberto = await entrar(Y, gReaberto, g4.codigo);
    rXReaberto = await responder(X, pXReaberto, gReaberto);
    const pZ4 = (await admin.query({ participantes: { $: { where: { chave: `${gReaberto}:${Z.id}` } } } })).participantes[0]!.id;
    const sorteio4 = id();
    await Z.db.transact(
      Z.db.tx.sorteios[sorteio4]!
        .create({ status: "pendente", rodada: 1, chave: `${gReaberto}:1`, criadoEm: Date.now() })
        .link({ grupo: gReaberto }),
    );
    await simularWorker(admin, sorteio4, [
      { doador: pZ4, receptor: pXReaberto },
      { doador: pXReaberto, receptor: pYReaberto },
      { doador: pYReaberto, receptor: pZ4 },
    ]);
    const reab = id();
    await Z.db.transact(
      Z.db.tx.reaberturas[reab]!.create({ status: "pendente", criadoEm: Date.now() }).link({ grupo: gReaberto }),
    );
    expect(await reabrir(admin, reab)).toEqual({ pares: 3 });
  });

  test("pedido de X: anonimiza no sorteado, sai do aberto, apaga o próprio grupo e a conta", async () => {
    pedido = await pedirExclusao(X);
    const ms = await esperarConcluido(pedido, X.id);
    console.log(`[tempo] apagar conta: ${ms} ms`);

    // $users sumiu.
    const { $users } = await admin.query({ $users: { $: { where: { id: X.id } } } });
    expect($users).toEqual([]);

    // Grupo sorteado: participação fica, anonimizada, sem usuário e sem respostas.
    const r = await admin.query({
      participantes: {
        $: { where: { id: { $in: [pX, pXAberto, pYNoDeX, pXReaberto] } } },
        usuario: {},
        respostas: {},
        doando: {},
        recebidoDe: {},
      },
      respostas: { $: { where: { id: { $in: [rX, rXAberto, rXReaberto] } } } },
      grupos: { $: { where: { id: { $in: [gSorteado, gAberto, gDeX, gReaberto] } } } },
      $files: { $: { where: { path: caminhoCapa(gDeX) } } },
    });
    const anon = r.participantes.find((p) => p.id === pX)!;
    expect(anon.removido).toBe(true);
    expect(anon.removidoNaRodada).toBe(1);
    expect(anon.apelido).toBe(APELIDO_REMOVIDO);
    expect(anon.usuario).toBeFalsy();
    expect(anon.respostas).toEqual([]);
    // Os pares da rodada continuam (os outros ainda veem quem tiraram).
    expect(anon.doando).toBeTruthy();
    expect(anon.recebidoDe).toBeTruthy();
    // Grupo aberto e grupo reaberto (rodada 1, sem pares): participação apagada, não anonimizada;
    // grupo de X: apagado (com a participação de Y e a capa).
    expect(r.participantes.map((p) => p.id)).toEqual([pX]);
    expect(r.respostas).toEqual([]);
    expect(r.grupos.map((g) => g.id).sort()).toEqual([gAberto, gSorteado, gReaberto].sort());
    expect(r.$files).toEqual([]);
  });

  test("o organizador vê o participante removido nesta rodada (banner) e a rodada segue", async () => {
    const r = await O.db.query({ grupos: { $: { where: { id: gSorteado } }, participantes: {} } });
    const g = r.grupos[0]!;
    const p = g.participantes.find((x) => x.id === pX)!;
    expect(p.apelido).toBe(APELIDO_REMOVIDO);
    expect(p.removido).toBe(true);
    expect(p.removidoNaRodada).toBe(g.rodadaAtual);
    expect(g.participantes.filter((x) => !x.removido)).toHaveLength(3);
  });

  test("idempotente: limpar de novo não muda nada; o mesmo pedido não roda de novo", async () => {
    expect(await limparDados(admin, X.id)).toEqual({ anonimizadas: 0, semRefazer: 0, apagadas: 0, grupos: 0 });
    const h = await ow.runWorkflow({ name: "apagar-conta", version: "1" } as never, { pedidoId: pedido }, {
      idempotencyKey: `${pedido}:outra`,
    });
    expect(await h.result({ timeoutMs: 15_000 })).toEqual({ ignorado: true });
    const { participantes } = await admin.query({ participantes: { $: { where: { id: pX } } } });
    expect(participantes).toHaveLength(1);
  });

  test("dois pedidos seguidos da mesma conta: os dois concluem, sem erro", async () => {
    const W = await criarUsuario(PREFIXO);
    const g = await criarGrupoTeste(O);
    const pW = await entrar(W, g.grupoId, g.codigo);
    const semCapa = await criarGrupoTeste(W); // grupo organizado sem capa: o delete da capa é no-op
    const [a, b] = [await pedirExclusao(W), await pedirExclusao(W)];
    await esperarConcluido(a!, W.id);
    await esperarConcluido(b!, W.id);
    const r = await admin.query({
      $users: { $: { where: { id: W.id } } },
      participantes: { $: { where: { id: pW } } },
      grupos: { $: { where: { id: semCapa.grupoId } } },
    });
    expect(r.$users).toEqual([]);
    expect(r.grupos).toEqual([]);
    expect(r.participantes).toEqual([]);
  });

  test("deleteUser falha além do retry: pedido segue pendente e a entrega seguinte termina", async () => {
    campainha.parar(); // o worker principal não deve pegar este pedido
    const arquivo = join(DIR, `ow-teste-${PREFIXO}-falha.db`);
    let falhar = true;
    // `auth.deleteUser` "fora do ar"; o resto do admin funciona.
    const dbInstavel = new Proxy(admin, {
      get(t, k, r) {
        const v = Reflect.get(t, k, r);
        if (k !== "auth" || !falhar) return v;
        return new Proxy(v, {
          get(a, k2, r2) {
            if (k2 === "deleteUser") return async () => { throw new Error("auth fora"); };
            return Reflect.get(a, k2, r2);
          },
        });
      },
    }) as AdminDb;
    const be = BackendSqlite.connect(arquivo);
    const ow2 = new OpenWorkflow({ backend: be });
    definirApagarConta(ow2, dbInstavel, { retryPasso: { maximumAttempts: 2, initialInterval: "50ms" } });
    const w2 = ow2.newWorker({ concurrency: 1 });
    await w2.start();
    const runs = () => {
      const d = new Database(arquivo, { readonly: true });
      try {
        return d.query("select idempotency_key as chave, status from workflow_runs").all() as { chave: string; status: string }[];
      } finally {
        d.close();
      }
    };
    try {
      const V = await criarUsuario(PREFIXO);
      const g = await criarGrupoTeste(O);
      const pV = await entrar(V, g.grupoId, g.codigo);
      const pedidoV = await pedirExclusao(V);

      await dispararComRetomada(ow2, specApagarConta, { pedidoId: pedidoV }, pedidoV);
      const t0 = Date.now();
      while (!runs().some((r) => r.status === "failed") && Date.now() - t0 < 15_000) await dormir(100);
      expect(runs().map((r) => r.status)).toEqual(["failed"]);
      const meio = await admin.query({
        pedidosExclusao: { $: { where: { id: pedidoV } } },
        $users: { $: { where: { id: V.id } } },
        participantes: { $: { where: { id: pV } } },
      });
      expect(meio.pedidosExclusao[0]!.status).toBe("pendente"); // não concluiu sem apagar o usuário
      expect(meio.$users).toHaveLength(1);
      expect(meio.participantes).toEqual([]); // limpar-dados já tinha rodado

      // O auth volta; a próxima entrega da campainha abre um run de retomada que termina.
      falhar = false;
      await dispararComRetomada(ow2, specApagarConta, { pedidoId: pedidoV }, pedidoV);
      await esperarConcluido(pedidoV, V.id);
      expect(runs().map((r) => r.status).sort()).toEqual(["completed", "failed"]);
    } finally {
      await w2.stop();
      await be.stop();
      for (const suf of ["", "-wal", "-shm"]) rmSync(arquivo + suf, { force: true });
    }
  });
});
