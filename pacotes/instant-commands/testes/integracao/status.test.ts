// Status writes against the real server (test app): no ghost writes on deleted commands.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { sendCommand } from "../../src/client";
import { markDone, markFailed, markRunning } from "../../src/worker/status";
import { sortear } from "../app/commands";
import { adminIC, criarGrupo, limpar, limparRestos, novoPrefixo, novoUsuario } from "../helpers";

setDefaultTimeout(30_000);

const PREFIXO = novoPrefixo("status");
const admin = adminIC();

beforeAll(limparRestos);
afterAll(() => limpar(PREFIXO));

async function novoCommand(): Promise<string> {
  const org = await novoUsuario(PREFIXO);
  const grupoId = await criarGrupo(PREFIXO, org);
  return sendCommand(org.db, sortear, { rodada: 1, chave: `${PREFIXO}-${crypto.randomUUID()}`, grupo: grupoId });
}

async function ler(cid: string) {
  const { sorteios } = await admin.query({ sorteios: { $: { where: { id: cid } } } });
  return sorteios[0];
}

describe("status writes", () => {
  test("markRunning: pending -> running and attempts+1 -> 'started'", async () => {
    const cid = await novoCommand();
    expect(await markRunning(admin, sortear, cid)).toBe("started");
    const r = await ler(cid);
    expect(r?.status).toBe("running");
    expect(r?.attempts).toBe(1);
  });

  test("markRunning: running -> attempts+1 -> 'resumed'", async () => {
    const cid = await novoCommand();
    await markRunning(admin, sortear, cid);
    expect(await markRunning(admin, sortear, cid)).toBe("resumed");
    const r = await ler(cid);
    expect(r?.status).toBe("running");
    expect(r?.attempts).toBe(2);
  });

  test("markRunning: done/failed -> 'finished', no write", async () => {
    const a = await novoCommand();
    await markRunning(admin, sortear, a);
    expect(await markDone(admin, sortear, a, { pares: 2 })).toBe(true);
    expect(await markRunning(admin, sortear, a)).toBe("finished");
    const ra = await ler(a);
    expect(ra?.status).toBe("done");
    expect(ra?.attempts).toBe(1);
    expect(ra?.result).toEqual({ pares: 2 });
    expect(ra?.error).toBeNull();
    expect(typeof ra?.finishedAt).toBe("number");

    const b = await novoCommand();
    await markRunning(admin, sortear, b);
    expect(await markFailed(admin, sortear, b, "boom")).toBe(true);
    expect(await markRunning(admin, sortear, b)).toBe("finished");
    const rb = await ler(b);
    expect(rb?.status).toBe("failed");
    expect(rb?.error).toBe("boom");
    expect(rb?.attempts).toBe(1);
  });

  test("markRunning on a deleted command -> 'absent'", async () => {
    const cid = await novoCommand();
    await admin.transact(admin.tx.sorteios[cid]!.delete());
    expect(await markRunning(admin, sortear, cid)).toBe("absent");
    expect(await ler(cid)).toBeUndefined();
  });

  test("markFailed on a deleted command writes nothing (no ghost)", async () => {
    const cid = await novoCommand();
    await admin.transact(admin.tx.sorteios[cid]!.delete());
    expect(await markFailed(admin, sortear, cid, "boom")).toBe(false);
    expect(await ler(cid)).toBeUndefined();
  });

  test("markDone on a deleted command writes nothing", async () => {
    const cid = await novoCommand();
    await admin.transact(admin.tx.sorteios[cid]!.delete());
    expect(await markDone(admin, sortear, cid, { pares: 1 })).toBe(false);
    expect(await ler(cid)).toBeUndefined();
  });

  test("markFailed on a done command → false, stays done", async () => {
    const cid = await novoCommand();
    await markRunning(admin, sortear, cid);
    await markDone(admin, sortear, cid, { pares: 2 });
    expect(await markFailed(admin, sortear, cid, "boom")).toBe(false);
    const r = await ler(cid);
    expect(r?.status).toBe("done");
    expect(r?.result).toEqual({ pares: 2 });
    expect(r?.error).toBeNull();
  });

  test("markDone on a failed command → false, stays failed", async () => {
    const cid = await novoCommand();
    await markRunning(admin, sortear, cid);
    await markFailed(admin, sortear, cid, "boom");
    expect(await markDone(admin, sortear, cid, { pares: 1 })).toBe(false);
    const r = await ler(cid);
    expect(r?.status).toBe("failed");
    expect(r?.error).toBe("boom");
    expect(r?.result ?? null).toBeNull();
  });
});
