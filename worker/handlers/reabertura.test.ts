// Integração do handler `reabertura`: app de TESTE do Instant + runner real da biblioteca
// (modo `subscription`, OpenWorkflow SQLite temporário, concorrência 1). A assinatura pode pegar
// pedidos abertos de outros prefixos: cada teste confere só os próprios ids.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { id } from "@instantdb/admin";
import { sendCommand, waitForCommand } from "instant-commands/client";
import { reabertura } from "@amigo/instant/commands";
import { adminTeste, criarGrupoTeste, criarUsuario, entrar, limparTudo, novoPrefixo, simularWorker, type Usuario } from "@amigo/instant/teste";
import {
  criarReaberturaHandler,
  MSG_GRUPO_NAO_SORTEADO,
  MSG_SORTEIO_EM_ANDAMENTO,
  reabrir,
} from "./reabertura";
import { rodarComRunner, type RunnerTeste } from "./teste";

setDefaultTimeout(60_000);

const PREFIXO = novoPrefixo("worker-reabertura");
const admin = adminTeste();
const ESPERA = { timeoutMs: 30_000 };
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterAll(async () => {
  await limparTudo(PREFIXO);
});

type Grupo = { grupoId: string; org: Usuario; participantes: string[] };

/** Grupo de `n` participantes (o organizador incluído), ainda aberto. Organizador novo por grupo. */
async function grupoCom(n: number): Promise<Grupo> {
  const org = await criarUsuario(PREFIXO);
  const g = await criarGrupoTeste(org);
  const participantes = [await entrar(org, g.grupoId, g.codigo)];
  for (let i = 1; i < n; i++) participantes.push(await entrar(await criarUsuario(PREFIXO), g.grupoId, g.codigo));
  return { grupoId: g.grupoId, org, participantes };
}

/** Grupo de `n` sorteado na rodada 1 (o admin faz o papel do worker do sorteio). */
async function grupoSorteado(n: number): Promise<Grupo> {
  const g = await grupoCom(n);
  const sorteioId = id();
  await admin.transact(
    admin.tx.sorteios[sorteioId]!
      .create({ status: "pending", attempts: 0, rodada: 1, chave: `${g.grupoId}:1`, createdAt: Date.now() })
      .link({ grupo: g.grupoId }),
  );
  const pares = g.participantes.map((doador, i) => ({ doador, receptor: g.participantes[(i + 1) % n]! }));
  await simularWorker(admin, sorteioId, pares);
  return g;
}

const lerGrupo = async (grupoId: string) =>
  (await admin.query({ grupos: { $: { where: { id: grupoId } } } })).grupos[0];
const lerReabertura = async (reaberturaId: string) =>
  (await admin.query({ reaberturas: { $: { where: { id: reaberturaId } } } })).reaberturas[0];
const paresDoGrupo = async (grupoId: string) =>
  (await admin.query({ pares: { $: { where: { "sorteio.grupo.id": grupoId } } } })).pares;

describe("reabertura: grupo apagado antes do run", () => {
  test("grupo apagado antes do run → nada recriado", async () => {
    const g = await grupoSorteado(3);
    const r = await sendCommand(g.org.db, reabertura, { grupo: g.grupoId });
    await g.org.db.transact(g.org.db.tx.grupos[g.grupoId]!.delete());
    // O passo `reabrir` relê: a reabertura sumiu em cascata, então não escreve nada.
    const semEscrita = {
      id: r,
      complete: () => {
        throw new Error("não devia completar");
      },
    };
    expect(await reabrir(admin, semEscrita as never)).toEqual({ ignorado: true });
    // E o runner, ligado depois, não acha nada para rodar nem recria nada.
    const amb = await rodarComRunner([criarReaberturaHandler()], { db: admin });
    try {
      await dormir(3000);
      expect(amb.eventos.some((e) => e.commandId === r)).toBe(false);
    } finally {
      await amb.parar();
    }
    expect(await lerGrupo(g.grupoId)).toBeUndefined();
    expect(await lerReabertura(r)).toBeUndefined();
  });
});

describe("reabertura: irmã aberta", () => {
  test("irmã aberta vira failed com MSG_GRUPO_NAO_SORTEADO na mesma transação", async () => {
    const g = await grupoSorteado(3);
    // Dois cliques: as duas são criadas, em lote, antes de o runner existir (determinístico).
    const [a, b] = [id(), id()];
    await admin.transact(
      [a, b].map((r) =>
        admin.tx.reaberturas[r]!
          .create({ status: "pending", attempts: 0, createdAt: Date.now(), error: null, result: null, finishedAt: null })
          .link({ grupo: g.grupoId }),
      ),
    );
    const amb = await rodarComRunner([criarReaberturaHandler()], { db: admin });
    try {
      const fins = await Promise.all([a, b].map((r) => waitForCommand(admin, reabertura, r as never, ESPERA)));
      const status = fins.map((f) => `${f.status}:${f.error ?? ""}`).sort();
      expect(status).toEqual(["done:", `failed:${MSG_GRUPO_NAO_SORTEADO}`]);
      expect(fins.find((f) => f.status === "done")!.result).toEqual({ pares: 3 });
    } finally {
      await amb.parar();
    }
    expect(await paresDoGrupo(g.grupoId)).toHaveLength(0);
    expect((await lerGrupo(g.grupoId))!.status).toBe("aberto");
  });
});

describe("handler reabertura", () => {
  let amb: RunnerTeste;
  beforeAll(async () => {
    amb = await rodarComRunner([criarReaberturaHandler()], { db: admin });
  });
  afterAll(async () => {
    await amb?.parar();
  });

  test("reabre o grupo sorteado: apaga os pares, grava aberto e rodadaBase, done com pares", async () => {
    const g = await grupoSorteado(3);
    expect(await paresDoGrupo(g.grupoId)).toHaveLength(3);
    const r = await sendCommand(g.org.db, reabertura, { grupo: g.grupoId });
    const fim = await waitForCommand(g.org.db, reabertura, r, ESPERA);
    expect(fim.status).toBe("done");
    expect(fim.result).toEqual({ pares: 3 });
    expect(fim.error ?? null).toBeNull();
    expect(typeof fim.finishedAt).toBe("number");
    expect(await paresDoGrupo(g.grupoId)).toHaveLength(0);
    const grupo = (await lerGrupo(g.grupoId))!;
    expect(grupo.status).toBe("aberto");
    expect(grupo.rodadaAtual).toBe(1);
    expect(grupo.rodadaBase).toBe(1);
  });

  test("grupo não sorteado → failed com MSG_GRUPO_NAO_SORTEADO", async () => {
    // A regra já recusa o organizador com o grupo aberto: o pedido sai pelo admin.
    const g = await grupoCom(3);
    const r = await sendCommand(admin, reabertura, { grupo: g.grupoId });
    const fim = await waitForCommand(admin, reabertura, r, ESPERA);
    expect(fim.status).toBe("failed");
    expect(fim.error).toBe(MSG_GRUPO_NAO_SORTEADO);
    const grupo = (await lerGrupo(g.grupoId))!;
    expect(grupo.status).toBe("aberto");
    expect(grupo.rodadaBase ?? null).toBeNull();
  });

  test("sorteio aberto no grupo → failed com MSG_SORTEIO_EM_ANDAMENTO", async () => {
    const g = await grupoSorteado(3);
    // Sorteio da rodada 2 `running` (escrito pelo admin: não há handler de sorteio neste runner).
    await admin.transact(
      admin.tx.sorteios[id()]!
        .create({ status: "running", attempts: 1, rodada: 2, chave: `${g.grupoId}:2`, createdAt: Date.now() })
        .link({ grupo: g.grupoId }),
    );
    // A regra recusa o organizador com sorteio aberto: o pedido sai pelo admin.
    const r = await sendCommand(admin, reabertura, { grupo: g.grupoId });
    const fim = await waitForCommand(admin, reabertura, r, ESPERA);
    expect(fim.status).toBe("failed");
    expect(fim.error).toBe(MSG_SORTEIO_EM_ANDAMENTO);
    expect(await paresDoGrupo(g.grupoId)).toHaveLength(3);
    expect((await lerGrupo(g.grupoId))!.status).toBe("sorteado");
  });
});
