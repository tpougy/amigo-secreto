// Integração do handler `exclusao-conta`: app de TESTE do Instant + runner real da biblioteca.
// Cada teste confere só os próprios ids (a assinatura pode pegar pedidos de outros prefixos).
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { id } from "@instantdb/admin";
import { sendCommand, waitForCommand } from "instant-commands/client";
import { exclusaoConta } from "@amigo/instant/commands";
import { APELIDO_REMOVIDO, caminhoCapa } from "@amigo/dominio";
import { adminTeste, criarGrupoTeste, criarUsuario, entrar, limparTudo, novoPrefixo, simularWorker, type Usuario } from "@amigo/instant/teste";
import type { AdminDb } from "./comum";
import { criarExclusaoContaHandler, limparDados, MSG_PADRAO_EXCLUSAO } from "./exclusaoConta";
import { rodarComRunner } from "./teste";

setDefaultTimeout(60_000);

const PREFIXO = novoPrefixo("worker-exclusao");
const admin = adminTeste();
const ESPERA = { timeoutMs: 30_000 };

afterAll(async () => {
  await limparTudo(PREFIXO);
});

/** O participante responde o primeiro campo de perfil do grupo. */
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

describe("handler exclusao-conta", () => {
  test("apaga a conta: participações, grupos organizados e $users; pedido done com o resumo", async () => {
    const [x, o] = await Promise.all([criarUsuario(PREFIXO), criarUsuario(PREFIXO)]);
    // Grupo sorteado de O (X participa): X vira "Participante removido".
    const g1 = await criarGrupoTeste(o, { organizadorParticipa: true });
    const pX = await entrar(x, g1.grupoId, g1.codigo);
    const pY = await entrar(await criarUsuario(PREFIXO), g1.grupoId, g1.codigo);
    const rX = await responder(x, pX, g1.grupoId);
    const pO = (await admin.query({ participantes: { $: { where: { chave: `${g1.grupoId}:${o.id}` } } } })).participantes[0]!.id;
    const sorteioId = id();
    await admin.transact(
      admin.tx.sorteios[sorteioId]!
        .create({ status: "pending", attempts: 0, rodada: 1, chave: `${g1.grupoId}:1`, createdAt: Date.now() })
        .link({ grupo: g1.grupoId }),
    );
    await simularWorker(admin, sorteioId, [
      { doador: pO, receptor: pX },
      { doador: pX, receptor: pY },
      { doador: pY, receptor: pO },
    ]);
    // Grupo aberto de O: a participação de X é apagada.
    const g2 = await criarGrupoTeste(o);
    const pXAberto = await entrar(x, g2.grupoId, g2.codigo);
    const rXAberto = await responder(x, pXAberto, g2.grupoId);
    // Grupo que X organiza.
    const g3 = await criarGrupoTeste(x, { organizadorParticipa: true });
    const capa = await admin.storage.uploadFile(caminhoCapa(g3.grupoId), Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
      contentType: "image/jpeg",
    });
    await admin.transact(admin.tx.grupos[g3.grupoId]!.link({ capa: capa.data.id }));

    const amb = await rodarComRunner([criarExclusaoContaHandler()], { db: admin });
    try {
      const pedido = await sendCommand(x.db, exclusaoConta, { usuario: x.id });
      // Depois que o `$users` some o pedido deixa de ser visível ao usuário: espera como admin.
      const fim = await waitForCommand(admin, exclusaoConta, pedido, ESPERA);
      const p = fim;
      expect(p.status).toBe("done");
      expect(p.result).toEqual({ anonimizadas: 1, semRefazer: 0, apagadas: 1, grupos: 1 });
      expect(p.error ?? null).toBeNull();
      expect(typeof p.finishedAt).toBe("number");
    } finally {
      await amb.parar();
    }
    expect((await admin.query({ $users: { $: { where: { id: x.id } } } })).$users).toEqual([]);
    const r = await admin.query({
      participantes: {
        $: { where: { id: { $in: [pX, pXAberto] } } },
        usuario: {},
        respostas: {},
        doando: {},
        recebidoDe: {},
      },
      respostas: { $: { where: { id: { $in: [rX, rXAberto] } } } },
      grupos: { $: { where: { id: { $in: [g1.grupoId, g2.grupoId, g3.grupoId] } } } },
      $files: { $: { where: { path: caminhoCapa(g3.grupoId) } } },
    });
    expect(r.participantes.map((p) => p.id)).toEqual([pX]);
    const anon = r.participantes[0]!;
    expect(anon.removido).toBe(true);
    expect(anon.removidoNaRodada).toBe(1);
    expect(anon.apelido).toBe(APELIDO_REMOVIDO);
    expect(anon.usuario).toBeFalsy();
    expect(anon.respostas).toEqual([]);
    // Os pares da rodada continuam: os outros ainda veem quem tiraram.
    expect(anon.doando).toBeTruthy();
    expect(anon.recebidoDe).toBeTruthy();
    expect(r.respostas).toEqual([]);
    expect(r.grupos.map((g) => g.id).sort()).toEqual([g1.grupoId, g2.grupoId].sort());
    expect(r.$files).toEqual([]);
    // O organizador vê o removido na rodada atual (banner).
    const vis = (await o.db.query({ grupos: { $: { where: { id: g1.grupoId } }, participantes: {} } })).grupos[0]!;
    expect(vis.participantes.find((p) => p.id === pX)!.removidoNaRodada).toBe(vis.rodadaAtual);

    // Idempotente: limpar de novo devolve o resumo vazio e não muda nada.
    expect(await limparDados(admin, x.id)).toEqual({ anonimizadas: 0, semRefazer: 0, apagadas: 0, grupos: 0 });
    expect((await admin.query({ participantes: { $: { where: { id: pX } } } })).participantes).toHaveLength(1);
  });

  test("auth.deleteUser falha além do retry → failed com a mensagem padrão, dados já limpos", async () => {
    const v = await criarUsuario(PREFIXO);
    const g = await criarGrupoTeste(await criarUsuario(PREFIXO));
    const pV = await entrar(v, g.grupoId, g.codigo);
    const dbInstavel = new Proxy(admin, {
      get(t, k, r) {
        const val = Reflect.get(t, k, r);
        if (k !== "auth") return typeof val === "function" ? val.bind(t) : val;
        return new Proxy(val, {
          get(a, k2, r2) {
            if (k2 === "deleteUser") return async () => { throw new Error("auth fora"); };
            return Reflect.get(a, k2, r2);
          },
        });
      },
    }) as AdminDb;
    const amb = await rodarComRunner(
      [criarExclusaoContaHandler({ retryPolicy: { maximumAttempts: 2, initialInterval: "50ms", backoffCoefficient: 1, maximumInterval: "50ms" } })],
      { db: dbInstavel },
    );
    try {
      const pedido = await sendCommand(v.db, exclusaoConta, { usuario: v.id });
      const fim = await waitForCommand(admin, exclusaoConta, pedido, ESPERA);
      expect(fim.status).toBe("failed");
      expect(fim.error).toBe(MSG_PADRAO_EXCLUSAO);
    } finally {
      await amb.parar();
    }
    const r = await admin.query({
      $users: { $: { where: { id: v.id } } },
      participantes: { $: { where: { id: pV } } },
    });
    expect(r.$users).toHaveLength(1); // o usuário continua: o reprocessamento diário tenta de novo
    expect(r.participantes).toEqual([]); // limpar-dados já tinha rodado
  });
});

describe("handler exclusao-conta: reexecução", () => {
  test("usuário já apagado (reexecução) → done sem erro", async () => {
    const x = await criarUsuario(PREFIXO);
    const pedido = await sendCommand(x.db, exclusaoConta, { usuario: x.id });
    // O usuário some antes de o runner existir: o pedido fica sem link, como numa reexecução.
    await admin.auth.deleteUser({ id: x.id });
    const amb = await rodarComRunner([criarExclusaoContaHandler()], { db: admin });
    try {
      const fim = await waitForCommand(admin, exclusaoConta, pedido, ESPERA);
      expect(fim.status).toBe("done");
      expect(fim.result).toEqual({ anonimizadas: 0, semRefazer: 0, apagadas: 0, grupos: 0 });
      expect(fim.error ?? null).toBeNull();
    } finally {
      await amb.parar();
    }
  });
});
