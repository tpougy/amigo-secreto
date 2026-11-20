// Integração do workflow `apagar-conta`: app de TESTE do Instant + worker real do OpenWorkflow
// (SQLite num arquivo temporário, concorrência 1).
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
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
} from "../../testes/instant-teste";
import { definirApagarConta, limparDados, processarPedidosExclusao } from "./apagarConta";

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
      participantes: { $: { where: { id: { $in: [pX, pXAberto, pYNoDeX] } } }, usuario: {}, respostas: {}, doando: {}, recebidoDe: {} },
      respostas: { $: { where: { id: { $in: [rX, rXAberto] } } } },
      grupos: { $: { where: { id: { $in: [gSorteado, gAberto, gDeX] } } } },
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
    // Grupo aberto: participação apagada; grupo de X: apagado (com a participação de Y e a capa).
    expect(r.participantes.map((p) => p.id)).toEqual([pX]);
    expect(r.respostas).toEqual([]);
    expect(r.grupos.map((g) => g.id).sort()).toEqual([gAberto, gSorteado].sort());
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
    expect(await limparDados(admin, X.id)).toEqual({ anonimizadas: 0, apagadas: 0, grupos: 0 });
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
});
