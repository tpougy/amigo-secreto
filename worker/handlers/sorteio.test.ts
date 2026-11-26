// Integração do handler `sorteio`: app de TESTE do Instant + runner real da biblioteca
// (modo `subscription`, OpenWorkflow SQLite temporário, concorrência 1). A assinatura pode pegar
// pedidos abertos de outros prefixos: cada teste confere só os próprios ids. Um runner por vez:
// os testes com db "sabotado" sobem o próprio runner e o param antes do próximo.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { id } from "@instantdb/admin";
import * as ic from "instant-commands/worker";
import { sendCommand, waitForCommand } from "instant-commands/client";
import { sortear } from "@amigo/dominio";
import { sorteio } from "@amigo/instant/commands";
import {
  adminTeste,
  adminTesteSemSchema,
  criarGrupoTeste,
  criarUsuario,
  entrar,
  limparTudo,
  novoPrefixo,
  type Usuario,
} from "@amigo/instant/teste";
import { seedDoSorteio } from "../nucleo/seed";
import type { AdminDb } from "./comum";
import {
  aoFalharSorteio,
  carregar,
  criarSorteioHandler,
  gravarPares,
  liberarChave,
  MSG_GRUPO_ENCERRADO,
  MSG_PADRAO_SORTEIO,
  MSG_PARTICIPANTES_MUDARAM,
  MSG_RODADA_INVALIDA,
  streamDoSorteio,
  type Carga,
} from "./sorteio";
import { rodarComRunner, type RunnerTeste } from "./teste";

setDefaultTimeout(60_000);

const PREFIXO = novoPrefixo("worker-sorteio");
const admin = adminTeste();
const ESPERA = { timeoutMs: 30_000 };
/** Segredo da seed só para os testes (em produção: `dokku config` do amigo-worker). */
const SEGREDO_TESTE = "0123456789abcdef".repeat(4);
const meusStreams: string[] = [];

afterAll(async () => {
  await limparTudo(PREFIXO);
  const semSchema = adminTesteSemSchema();
  const { $streams } = await semSchema.query({
    $streams: { $: { where: { clientId: { $in: meusStreams.length ? meusStreams : ["-"] } } } },
  });
  if ($streams.length) await semSchema.transact($streams.map((s) => semSchema.tx.$streams[s.id]!.delete()));
});

type Grupo = { grupoId: string; org: Usuario; participantes: string[] };

/** Grupo aberto de `n` participantes (o organizador incluído). */
async function grupoCom(n: number): Promise<Grupo> {
  const org = await criarUsuario(PREFIXO);
  const g = await criarGrupoTeste(org);
  const participantes = [await entrar(org, g.grupoId, g.codigo)];
  for (let i = 1; i < n; i++) participantes.push(await entrar(await criarUsuario(PREFIXO), g.grupoId, g.codigo));
  return { grupoId: g.grupoId, org, participantes };
}

/** O organizador pede o sorteio da rodada (como o botão "Sortear"). */
async function pedirSorteio(g: Grupo, rodada = 1) {
  const sid = await sendCommand(g.org.db, sorteio, { rodada, chave: `${g.grupoId}:${rodada}`, grupo: g.grupoId });
  meusStreams.push(streamDoSorteio(sid));
  return sid;
}

async function restringir(g: Grupo, a: string, b: string) {
  await g.org.db.transact(
    g.org.db.tx.restricoes[id()]!.create({}).link({ grupo: g.grupoId, participanteA: a, participanteB: b }),
  );
}

const lerSorteio = async (sid: string) =>
  (await admin.query({ sorteios: { $: { where: { id: sid } }, pares: {} } })).sorteios[0];
const lerGrupo = async (grupoId: string) =>
  (await admin.query({ grupos: { $: { where: { id: grupoId } } } })).grupos[0];
const paresDoGrupo = async (grupoId: string) =>
  (await admin.query({ pares: { $: { where: { "sorteio.grupo.id": grupoId } }, doador: {}, receptor: {} } })).pares;

/** Lê (como admin) o stream de progresso do sorteio até ele fechar. */
async function lerProgresso(sid: string, prazoMs = 5000): Promise<string> {
  const leitor = admin.streams.createReadStream({ clientId: streamDoSorteio(sid) }).getReader();
  const prazo = setTimeout(() => void leitor.cancel().catch(() => {}), prazoMs);
  let texto = "";
  try {
    for (;;) {
      const { value, done } = await leitor.read();
      if (done) break;
      texto += value;
    }
  } finally {
    clearTimeout(prazo);
  }
  return texto;
}

/** A consulta de `estadoAtual` (só ela pede `pares` do sorteio): é a releitura do `gravar-pares`. */
const ehReleituraDoGravar = (q: unknown) =>
  typeof q === "object" && q !== null && "sorteios" in q && typeof (q as any).sorteios === "object" && "pares" in (q as any).sorteios;

/**
 * O admin de teste com `antes` executado antes de cada releitura do `gravar-pares` (para mudar o
 * mundo "durante o run" ou simular o Instant fora). Os métodos ficam ligados ao admin real.
 */
function dbCom(antes: () => Promise<void>): AdminDb {
  return new Proxy(admin, {
    get(t, k) {
      const v = Reflect.get(t, k, t);
      if (k === "query") {
        return async (q: unknown, ...resto: unknown[]) => {
          if (ehReleituraDoGravar(q)) await antes();
          return (t.query as any)(q, ...resto);
        };
      }
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}

/** Handle mínimo de command para chamar `gravarPares` direto, num caminho que não deve completar. */
const handle = (sid: string) =>
  ({
    id: sid,
    complete: () => {
      throw new Error("não devia completar");
    },
  }) as never;

describe("sorteio: passo que esgota as tentativas", () => {
  test("passo que esgota as tentativas (política curta) → failed com a mensagem padrão e chave renomeada; nova rodada igual é aceita por sendCommand", async () => {
    const g = await grupoCom(3);
    const fora = dbCom(async () => {
      throw new Error("instant fora");
    });
    const amb = await rodarComRunner(
      [criarSorteioHandler({ segredo: SEGREDO_TESTE, retryPolicy: { maximumAttempts: 2, initialInterval: "50ms" } })],
      { db: fora },
    );
    let sid: string;
    try {
      sid = await pedirSorteio(g);
      const fim = await waitForCommand(admin, sorteio, sid as never, ESPERA);
      expect(fim.status).toBe("failed");
      expect(fim.error).toBe(MSG_PADRAO_SORTEIO);
      expect((await lerSorteio(sid))!.chave).toBe(`${g.grupoId}:1:erro:${sid}`);
    } finally {
      await amb.parar();
    }
    expect(await paresDoGrupo(g.grupoId)).toHaveLength(0);
    expect((await lerGrupo(g.grupoId))!.status).toBe("aberto");

    // A chave `<grupo>:1` ficou livre: o organizador pede a mesma rodada de novo, e ela conclui.
    const novo = await pedirSorteio(g);
    expect(novo).not.toBe(sid);
    const ok = await rodarComRunner([criarSorteioHandler({ segredo: SEGREDO_TESTE })], { db: admin });
    try {
      const fim = await waitForCommand(admin, sorteio, novo, ESPERA);
      expect(fim.status).toBe("done");
      expect(fim.result).toEqual({ pares: 3 });
    } finally {
      await ok.parar();
    }
  });
});

describe("sorteio: mudanças durante o run", () => {
  test("participantes mudaram entre carregar e gravar → failed com MSG_PARTICIPANTES_MUDARAM e chave renomeada", async () => {
    const g = await grupoCom(3);
    let entrou = false;
    // Na primeira releitura do `gravar-pares`, um participante novo entra (forçado pelo admin).
    const db = dbCom(async () => {
      if (entrou) return;
      entrou = true;
      const novo = await criarUsuario(PREFIXO);
      await admin.transact(
        admin.tx.participantes[id()]!
          .create({ apelido: "novo", perfilCompleto: false, removido: false, entrouEm: Date.now(), chave: `${g.grupoId}:${novo.id}` })
          .link({ grupo: g.grupoId, usuario: novo.id }),
      );
    });
    const amb = await rodarComRunner([criarSorteioHandler({ segredo: SEGREDO_TESTE })], { db });
    try {
      const sid = await pedirSorteio(g);
      const fim = await waitForCommand(admin, sorteio, sid, ESPERA);
      expect(fim.status).toBe("failed");
      expect(fim.error).toBe(MSG_PARTICIPANTES_MUDARAM);
      expect((await lerSorteio(sid))!.chave).toBe(`${g.grupoId}:1:erro:${sid}`);
      expect(entrou).toBe(true);
    } finally {
      await amb.parar();
    }
    expect(await paresDoGrupo(g.grupoId)).toHaveLength(0);
    const grupo = (await lerGrupo(g.grupoId))!;
    expect(grupo.status).toBe("aberto");
    expect(grupo.rodadaAtual).toBe(0);
  });

  test("gravarPares direto: participante saiu → ic.fail com MSG_PARTICIPANTES_MUDARAM, sem pares", async () => {
    const g = await grupoCom(4);
    const sid = await pedirSorteio(g);
    const carga = (await carregar(admin, sid)) as Carga;
    expect(carga.participantes).toHaveLength(4);
    await admin.transact(admin.tx.participantes[g.participantes[3]!]!.delete());
    const erro = await gravarPares(admin, SEGREDO_TESTE, handle(sid), carga).catch((e) => e);
    expect(erro).toBeInstanceOf(ic.CommandFailure);
    expect((erro as Error).message).toBe(MSG_PARTICIPANTES_MUDARAM);
    expect(await paresDoGrupo(g.grupoId)).toHaveLength(0);
    // Sem runner aqui: apaga o pedido para nenhum runner seguinte pegá-lo.
    await admin.transact(admin.tx.sorteios[sid]!.delete());
  });

  test("grupo encerrado durante o run → failed com MSG_GRUPO_ENCERRADO, grupo intocado e chave renomeada", async () => {
    const g = await grupoCom(3);
    let encerrou = false;
    const db = dbCom(async () => {
      if (encerrou) return;
      encerrou = true;
      await admin.transact(admin.tx.grupos[g.grupoId]!.update({ status: "encerrado" }));
    });
    const amb = await rodarComRunner([criarSorteioHandler({ segredo: SEGREDO_TESTE })], { db });
    try {
      const sid = await pedirSorteio(g);
      const fim = await waitForCommand(admin, sorteio, sid, ESPERA);
      expect(fim.status).toBe("failed");
      expect(fim.error).toBe(MSG_GRUPO_ENCERRADO);
      expect((await lerSorteio(sid))!.chave).toBe(`${g.grupoId}:1:erro:${sid}`);
    } finally {
      await amb.parar();
    }
    const grupo = (await lerGrupo(g.grupoId))!;
    expect(grupo.status).toBe("encerrado");
    expect(grupo.rodadaAtual).toBe(0);
    expect(await paresDoGrupo(g.grupoId)).toHaveLength(0);
  });

  test("grupo apagado durante o run → nada recriado", async () => {
    const g = await grupoCom(3);
    let apagado = false;
    // Na primeira releitura do `gravar-pares`, o organizador apaga o grupo (sorteio vai junto).
    const db = dbCom(async () => {
      if (apagado) return;
      apagado = true;
      await g.org.db.transact(g.org.db.tx.grupos[g.grupoId]!.delete());
    });
    const amb = await rodarComRunner([criarSorteioHandler({ segredo: SEGREDO_TESTE })], { db });
    let sid = "";
    try {
      sid = await pedirSorteio(g);
      const t0 = Date.now();
      while (!amb.eventos.some((e) => e.commandId === sid && (e.type === "run.done" || e.type === "run.failed" || e.type === "run.skipped"))) {
        if (Date.now() - t0 > 30_000) throw new Error(`run não terminou: ${JSON.stringify(amb.eventos.filter((e) => e.commandId === sid))}`);
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(apagado).toBe(true);
      expect(amb.eventos.some((e) => e.commandId === sid && e.type === "command.failed")).toBe(false);
    } finally {
      await amb.parar();
    }
    const r = await admin.query({
      grupos: { $: { where: { id: g.grupoId } } },
      sorteios: { $: { where: { id: sid } } },
      pares: { $: { where: { chave: { $in: g.participantes.map((p) => `${sid}:${p}`) } } } },
    });
    expect(r.grupos).toEqual([]);
    expect(r.sorteios).toEqual([]);
    expect(r.pares).toEqual([]);
  });
});

describe("liberarChave", () => {
  test("renomeia a chave; sem chave string, nada", () => {
    const sid = id();
    const chunks = liberarChave({ db: admin, reason: "fail", error: "x", command: { id: sid, chave: "g:1", rodada: 1 } as never });
    expect(chunks).toHaveLength(1);
    expect(liberarChave({ db: admin, reason: "invalid_input", error: "x", command: { id: sid } as never })).toEqual([]);
  });

  test("valor exato renomeado; chave que já termina em :erro:<id> não ganha sufixo duplo", () => {
    const sid = id();
    const [chunk] = liberarChave({ db: admin, reason: "fail", error: "x", command: { id: sid, chave: "g:1", rodada: 1 } as never });
    expect(JSON.stringify(chunk)).toContain(`g:1:erro:${sid}`);
    expect(JSON.stringify(chunk)).not.toContain(`:erro:${sid}:erro:`);
    expect(liberarChave({ db: admin, reason: "fail", error: "x", command: { id: sid, chave: `g:1:erro:${sid}`, rodada: 1 } as never })).toEqual([]);
  });
});

describe("handler sorteio", () => {
  let amb: RunnerTeste;
  beforeAll(async () => {
    amb = await rodarComRunner([criarSorteioHandler({ segredo: SEGREDO_TESTE })], {
      db: admin,
      // Como o `onEvent` do main (Task 6): a fase `erro` final no stream.
      onEvent: (e) => {
        if (e.type === "command.failed" && e.command === "sorteio" && e.commandId) aoFalharSorteio(admin, e.commandId);
      },
    });
  });
  afterAll(async () => {
    await amb?.parar();
  });

  let feliz: { g: Grupo; sid: string };

  test("sorteio feliz: pares gravados, grupo sorteado, done com { pares }", async () => {
    const g = await grupoCom(4);
    const sid = await pedirSorteio(g);
    feliz = { g, sid };
    const fim = await waitForCommand(g.org.db, sorteio, sid, ESPERA);
    expect(fim.status).toBe("done");
    expect(fim.result).toEqual({ pares: 4 });
    expect(fim.error ?? null).toBeNull();
    expect(typeof fim.finishedAt).toBe("number");
    expect((await lerSorteio(sid))!.chave).toBe(`${g.grupoId}:1`);

    const grupo = (await lerGrupo(g.grupoId))!;
    expect(grupo.status).toBe("sorteado");
    expect(grupo.rodadaAtual).toBe(1);
    // Determinismo: a seed é HMAC(segredo, id do command), e os pares gravados batem com ela.
    const esperado = sortear(g.participantes, [], seedDoSorteio(SEGREDO_TESTE, sid))
      .map((p) => `${p.doador}>${p.receptor}`)
      .sort();
    const gravados = (await paresDoGrupo(g.grupoId)).map((p) => `${p.doador!.id}>${p.receptor!.id}`).sort();
    expect(gravados).toEqual(esperado);
  });

  test("o stream recebe embaralhando, sorteando e pronto", async () => {
    expect(await lerProgresso(feliz.sid)).toBe("embaralhando\nsorteando\npronto\n");
  });

  test("reexecutar gravar-pares com o command já done devolve a contagem gravada, sem escrever", async () => {
    const { g, sid } = feliz;
    const carga: Carga = { grupoId: g.grupoId, rodada: 1, participantes: [...g.participantes].sort(), restricoes: [], paresAntigos: [] };
    const antes = (await paresDoGrupo(g.grupoId)).map((p) => p.id).sort();
    const r = await gravarPares(admin, SEGREDO_TESTE, handle(sid), carga);
    expect(r).toEqual({ pares: 4 });
    expect((await paresDoGrupo(g.grupoId)).map((p) => p.id).sort()).toEqual(antes);
  });

  test("rodada 2 depois de uma anterior: apaga os pares antigos e grava só os novos (um por doador/receptor)", async () => {
    const { g, sid: sid1 } = feliz;
    const antigos = (await paresDoGrupo(g.grupoId)).map((p) => p.id);
    expect(antigos).toHaveLength(4);
    // Um participante sai (removido) e o organizador pede a rodada 2.
    const saiu = g.participantes[3]!;
    await admin.transact(admin.tx.participantes[saiu]!.update({ removido: true }));
    const sid2 = await pedirSorteio(g, 2);
    const fim = await waitForCommand(g.org.db, sorteio, sid2, ESPERA);
    expect(fim.status).toBe("done");
    expect(fim.result).toEqual({ pares: 3 });

    const todos = await paresDoGrupo(g.grupoId);
    expect(todos).toHaveLength(3);
    expect(todos.some((p) => antigos.includes(p.id))).toBe(false);
    const ativos = g.participantes.slice(0, 3).sort();
    expect(todos.map((p) => p.doador!.id).sort()).toEqual(ativos);
    expect(todos.map((p) => p.receptor!.id).sort()).toEqual(ativos);
    expect((await lerSorteio(sid1))!.pares).toHaveLength(0);
    const grupo = (await lerGrupo(g.grupoId))!;
    expect(grupo.rodadaAtual).toBe(2);
    expect(grupo.status).toBe("sorteado");
  });

  test("rodada inválida → failed com MSG_RODADA_INVALIDA", async () => {
    const g = await grupoCom(3);
    // A regra recusa o organizador: o pedido sai pelo admin.
    const sid = await sendCommand(admin, sorteio, { rodada: 2, chave: `${g.grupoId}:2`, grupo: g.grupoId });
    meusStreams.push(streamDoSorteio(sid));
    const fim = await waitForCommand(admin, sorteio, sid, ESPERA);
    expect(fim.status).toBe("failed");
    expect(fim.error).toBe(MSG_RODADA_INVALIDA);
    expect((await lerSorteio(sid))!.chave).toBe(`${g.grupoId}:2:erro:${sid}`);
    expect((await lerGrupo(g.grupoId))!.status).toBe("aberto");
  });

  test("restrições impossíveis → failed com a mensagem do ErroSorteio, chave liberada, stream termina em erro", async () => {
    const g = await grupoCom(3);
    const [a, b, c] = g.participantes as [string, string, string];
    await restringir(g, a, b);
    await restringir(g, b, c);
    const sid = await pedirSorteio(g);
    const fim = await waitForCommand(admin, sorteio, sid, ESPERA);
    expect(fim.status).toBe("failed");
    expect(fim.error).toBe("As restrições tornam o sorteio impossível");
    expect((await lerSorteio(sid))!.chave).toBe(`${g.grupoId}:1:erro:${sid}`);
    expect((await lerSorteio(sid))!.pares).toHaveLength(0);
    expect(await lerProgresso(sid)).toBe("embaralhando\nsorteando\nerro\n");
    const grupo = (await lerGrupo(g.grupoId))!;
    expect(grupo.status).toBe("aberto");
    expect(grupo.rodadaAtual).toBe(0);
  });
});
