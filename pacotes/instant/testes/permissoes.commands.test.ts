// Regras geradas por `mergePerms` para os três commands (sorteio, reabertura, exclusão de conta):
// estados `running`, imutabilidade do status, links de pares e exclusão. Roda contra o app de
// TESTE (amigo-secreto-teste). Ver pacotes/instant/commands.ts e perms.ts.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { id } from "@instantdb/admin";
import { sendCommand } from "instant-commands/client";
import { exclusaoConta, reabertura, sorteio } from "../commands";
import {
  adminTeste,
  criarGrupoTeste,
  criarUsuario,
  entrar,
  erroDe,
  limparTudo,
  novoPrefixo,
  tipoErro,
  type Usuario,
} from "./instant-teste";

setDefaultTimeout(30_000);

const PREFIXO = novoPrefixo("perm-commands");
const admin = adminTeste();

// Cada teste usa um organizador novo: o rateLimit de sorteios/reaberturas é de 5 por hora por usuário.
let A: Usuario; // membro
let B: Usuario;
let C: Usuario; // retardatário
let estranho: Usuario;

async function negado(p: Promise<unknown>) {
  const e = await erroDe(p);
  expect(tipoErro(e)).toBe("permission-denied");
}

/** Organizador novo e grupo com ele, A e B; `sorteado` na rodada 1 se pedido (como o worker deixaria). */
async function grupoCom(sorteado: boolean) {
  const O = await criarUsuario(PREFIXO);
  const g = await criarGrupoTeste(O);
  const pO = await entrar(O, g.grupoId, g.codigo);
  const pA = await entrar(A, g.grupoId, g.codigo);
  const pB = await entrar(B, g.grupoId, g.codigo);
  if (sorteado) {
    await admin.transact(admin.tx.grupos[g.grupoId]!.update({ status: "sorteado", rodadaAtual: 1 }));
  }
  return { ...g, O, pO, pA, pB };
}

/** Escreve o status como o worker (admin) escreveria. */
async function marcar(entidade: "sorteios" | "reaberturas", cmdId: string, status: "running" | "done" | "failed") {
  const fim = status === "running" ? {} : { finishedAt: Date.now() };
  await admin.transact(admin.tx[entidade][cmdId]!.update({ status, attempts: 1, ...fim }));
}

beforeAll(async () => {
  [A, B, C, estranho] = await Promise.all(Array.from({ length: 4 }, () => criarUsuario(PREFIXO)));
});

afterAll(async () => {
  await limparTudo(PREFIXO);
});

describe("pedidos abertos (pending ou running)", () => {
  test("sorteio negado com reabertura running", async () => {
    const g = await grupoCom(true);
    const O = g.O;
    const r = await sendCommand(O.db, reabertura, { grupo: g.grupoId });
    await marcar("reaberturas", r, "running");
    const pedir = () => sendCommand(O.db, sorteio, { rodada: 2, chave: `${g.grupoId}:2`, grupo: g.grupoId });
    await negado(pedir());
    // Controle: com a reabertura terminada, o mesmo pedido passa.
    await marcar("reaberturas", r, "done");
    await pedir();
  });

  test("reabertura negada com sorteio running", async () => {
    const g = await grupoCom(false);
    const O = g.O;
    const s = await sendCommand(O.db, sorteio, { rodada: 1, chave: `${g.grupoId}:1`, grupo: g.grupoId });
    await marcar("sorteios", s, "running");
    await admin.transact(admin.tx.grupos[g.grupoId]!.update({ status: "sorteado", rodadaAtual: 0 }));
    await negado(sendCommand(O.db, reabertura, { grupo: g.grupoId }));
    // Controle: com o sorteio terminado, a reabertura passa.
    await marcar("sorteios", s, "done");
    await sendCommand(O.db, reabertura, { grupo: g.grupoId });
  });

  test("entrada de participante negada com sorteio running", async () => {
    const g = await grupoCom(false);
    const s = await sendCommand(g.O.db, sorteio, { rodada: 1, chave: `${g.grupoId}:1`, grupo: g.grupoId });
    await marcar("sorteios", s, "running");
    await negado(entrar(C, g.grupoId, g.codigo));
    // Controle: com o sorteio terminado em falha, a entrada passa.
    await marcar("sorteios", s, "failed");
    await entrar(C, g.grupoId, g.codigo);
  });
});

describe("imutabilidade dos commands para o cliente", () => {
  test("cliente não muda status de command", async () => {
    const g = await grupoCom(false);
    const O = g.O;
    const s = await sendCommand(O.db, sorteio, { rodada: 1, chave: `${g.grupoId}:1`, grupo: g.grupoId });
    await negado(O.db.transact(O.db.tx.sorteios[s]!.update({ status: "done" })));
    await negado(O.db.transact(O.db.tx.sorteios[s]!.update({ status: "failed", error: "x" })));
    await negado(O.db.transact(O.db.tx.sorteios[s]!.update({ error: "x" })));

    const g2 = await grupoCom(true);
    const r = await sendCommand(g2.O.db, reabertura, { grupo: g2.grupoId });
    await negado(g2.O.db.transact(g2.O.db.tx.reaberturas[r]!.update({ status: "done" })));
    await negado(g2.O.db.transact(g2.O.db.tx.reaberturas[r]!.update({ error: "x" })));
    await negado(A.db.transact(A.db.tx.reaberturas[r]!.update({ status: "failed" })));
  });

  test("cliente não liga nem desliga pares de um sorteio", async () => {
    const g = await grupoCom(false);
    const O = g.O;
    const s = await sendCommand(O.db, sorteio, { rodada: 1, chave: `${g.grupoId}:1`, grupo: g.grupoId });
    // O worker (admin) grava os pares do sorteio e um par solto, sem sorteio.
    const p1 = id();
    const p2 = id();
    const solto = id();
    await admin.transact([
      admin.tx.pares[p1]!.create({ chave: `${s}:${g.pO}` }).link({ sorteio: s, doador: g.pO, receptor: g.pA }),
      admin.tx.pares[p2]!.create({ chave: `${s}:${g.pA}` }).link({ sorteio: s, doador: g.pA, receptor: g.pB }),
      admin.tx.pares[solto]!.create({ chave: `solto:${g.pB}` }).link({ doador: g.pB, receptor: g.pO }),
      admin.tx.sorteios[s]!.update({ status: "done", finishedAt: Date.now() }),
      admin.tx.grupos[g.grupoId]!.update({ status: "sorteado", rodadaAtual: 1 }),
    ]);

    for (const u of [O, A]) {
      // Pelo lado do sorteio.
      await negado(u.db.transact(u.db.tx.sorteios[s]!.link({ pares: solto })));
      await negado(u.db.transact(u.db.tx.sorteios[s]!.unlink({ pares: p1 })));
      // Pelo lado do par.
      await negado(u.db.transact(u.db.tx.pares[solto]!.link({ sorteio: s })));
      await negado(u.db.transact(u.db.tx.pares[p2]!.unlink({ sorteio: s })));
    }

    // Nada mudou.
    const { sorteios } = await admin.query({ sorteios: { $: { where: { id: s } }, pares: {} } });
    expect(sorteios[0]!.pares.map((p) => p.id).sort()).toEqual([p1, p2].sort());
  });
});

describe("exclusão de conta", () => {
  test("exclusão: dono cria e vê; outro não vê nem cria para terceiros", async () => {
    const pedido = await sendCommand(A.db, exclusaoConta, { usuario: A.id });

    const doDono = await A.db.query({ pedidosExclusao: { $: { where: { id: pedido } } } });
    expect(doDono.pedidosExclusao).toHaveLength(1);
    expect(doDono.pedidosExclusao[0]!.status).toBe("pending");

    const doOutro = await estranho.db.query({ pedidosExclusao: { $: { where: { id: pedido } } } });
    expect(doOutro.pedidosExclusao).toHaveLength(0);

    await negado(sendCommand(estranho.db, exclusaoConta, { usuario: A.id }));
    await negado(estranho.db.transact(estranho.db.tx.pedidosExclusao[pedido]!.update({ status: "done" })));
    await negado(A.db.transact(A.db.tx.pedidosExclusao[pedido]!.update({ status: "done" })));
  });
});

describe("sorteio feliz", () => {
  test("sorteio feliz: organizador cria a rodada 1 com sendCommand", async () => {
    const g = await grupoCom(false);
    const s = await sendCommand(g.O.db, sorteio, { rodada: 1, chave: `${g.grupoId}:1`, grupo: g.grupoId });
    const { sorteios } = await admin.query({ sorteios: { $: { where: { id: s } }, grupo: {} } });
    expect(sorteios[0]).toMatchObject({ status: "pending", attempts: 0, rodada: 1 });
    expect(sorteios[0]!.grupo?.id).toBe(g.grupoId);
  });
});
