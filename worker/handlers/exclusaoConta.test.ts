// Integração do handler `exclusao-conta`: app de TESTE do Instant + runner real da biblioteca.
// Cada teste confere só os próprios ids (a assinatura pode pegar pedidos de outros prefixos).
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { id } from "@instantdb/admin";
import { sendCommand, waitForCommand } from "instant-commands/client";
import { exclusaoConta } from "@amigo/instant/commands";
import { APELIDO_REMOVIDO } from "@amigo/dominio";
import { adminTeste, criarGrupoTeste, criarUsuario, entrar, limparTudo, novoPrefixo, simularWorker } from "@amigo/instant/teste";
import { criarExclusaoContaHandler } from "./exclusaoConta";
import { rodarComRunner } from "./teste";

setDefaultTimeout(60_000);

const PREFIXO = novoPrefixo("worker-exclusao");
const admin = adminTeste();
const ESPERA = { timeoutMs: 30_000 };

afterAll(async () => {
  await limparTudo(PREFIXO);
});

describe("handler exclusao-conta", () => {
  test("apaga a conta: participações, grupos organizados e $users; pedido done com o resumo", async () => {
    const [x, o] = await Promise.all([criarUsuario(PREFIXO), criarUsuario(PREFIXO)]);
    // Grupo sorteado de O (X participa): X vira "Participante removido".
    const g1 = await criarGrupoTeste(o, { organizadorParticipa: true });
    const pX = await entrar(x, g1.grupoId, g1.codigo);
    const pY = await entrar(await criarUsuario(PREFIXO), g1.grupoId, g1.codigo);
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
    // Grupo que X organiza.
    const g3 = await criarGrupoTeste(x, { organizadorParticipa: true });

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
      participantes: { $: { where: { id: { $in: [pX, pXAberto] } } }, usuario: {} },
      grupos: { $: { where: { id: { $in: [g1.grupoId, g2.grupoId, g3.grupoId] } } } },
    });
    expect(r.participantes.map((p) => p.id)).toEqual([pX]);
    const anon = r.participantes[0]!;
    expect(anon.removido).toBe(true);
    expect(anon.apelido).toBe(APELIDO_REMOVIDO);
    expect(anon.usuario).toBeFalsy();
    expect(r.grupos.map((g) => g.id).sort()).toEqual([g1.grupoId, g2.grupoId].sort());
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
