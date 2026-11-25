// The typed client against the real server (test app).
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { sendCommand, subscribeCommand, waitForCommand, type CommandState } from "../../src/client";
import { sortear } from "../app/commands";
import { adminIC, clienteCoreIC, criarGrupo, esperarAte, limpar, limparRestos, novoPrefixo, novoUsuario } from "../helpers";

setDefaultTimeout(30_000);

const PREFIXO = novoPrefixo("cliente");
const admin = adminIC();

beforeAll(limparRestos);
afterAll(() => limpar(PREFIXO));

describe("client", () => {
  test("send then subscribe sees pending", async () => {
    const org = await novoUsuario(PREFIXO);
    const grupoId = await criarGrupo(PREFIXO, org);
    const cid = await sendCommand(org.db, sortear, { rodada: 1, chave: `${PREFIXO}-${crypto.randomUUID()}`, grupo: grupoId });
    const states: CommandState<typeof sortear>[] = [];
    const off = subscribeCommand(org.db, sortear, cid, (s) => states.push(s));
    try {
      await esperarAte(async () => states.some((s) => s !== null));
    } finally {
      off();
    }
    const s = states.find((x) => x !== null)!;
    expect(s.id).toBe(cid);
    expect(s.status).toBe("pending");
    expect(s.attempts).toBe(0);
    expect(s.result).toBeNull();
    expect(s.finishedAt).toBeNull();
  });

  test("core SDK path: sendCommand + subscribeCommand through @instantdb/core", async () => {
    const org = await novoUsuario(PREFIXO);
    const grupoId = await criarGrupo(PREFIXO, org);
    await clienteCoreIC(org, async (db) => {
      const cid = await sendCommand(db, sortear, { rodada: 1, chave: `${PREFIXO}-${crypto.randomUUID()}`, grupo: grupoId });
      const states: CommandState<typeof sortear>[] = [];
      const off = subscribeCommand(db, sortear, cid, (s) => states.push(s));
      try {
        await esperarAte(async () => states.some((s) => s?.status === "pending"));
      } finally {
        off();
      }
      const { sorteios } = await admin.query({ sorteios: { $: { where: { id: cid } }, grupo: {} } });
      expect(sorteios[0]?.grupo?.id).toBe(grupoId);
    });
  });

  test("waitForCommand resolves when an admin marks done", async () => {
    const org = await novoUsuario(PREFIXO);
    const grupoId = await criarGrupo(PREFIXO, org);
    const cid = await sendCommand(org.db, sortear, { rodada: 1, chave: `${PREFIXO}-${crypto.randomUUID()}`, grupo: grupoId });
    const espera = waitForCommand(org.db, sortear, cid, { timeoutMs: 15_000 });
    await new Promise((r) => setTimeout(r, 500));
    await admin.transact(admin.tx.sorteios[cid]!.update({ status: "done", result: { pares: 4 }, finishedAt: Date.now() }));
    const s = await espera;
    expect(s.status).toBe("done");
    expect(s.result).toEqual({ pares: 4 });
    expect(s.finishedAt).not.toBeNull();
  });

  test("waitForCommand rejects on timeout", async () => {
    const org = await novoUsuario(PREFIXO);
    const grupoId = await criarGrupo(PREFIXO, org);
    const cid = await sendCommand(org.db, sortear, { rodada: 1, chave: `${PREFIXO}-${crypto.randomUUID()}`, grupo: grupoId });
    await expect(waitForCommand(org.db, sortear, cid, { timeoutMs: 300 })).rejects.toThrow(/timed out/i);
  });
});
