// Subscription trigger against the test app.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { sendCommand } from "../../src/client";
import type { Engine } from "../../src/worker/engine";
import { startSubscriptionTrigger } from "../../src/worker/subscription";
import { sortear } from "../app/commands";
import { adminIC, criarGrupo, esperarAte, limpar, limparRestos, novoPrefixo, novoUsuario } from "../helpers";

setDefaultTimeout(30_000);

const PREFIXO = novoPrefixo("assinatura");

beforeAll(limparRestos);
afterAll(() => limpar(PREFIXO));

test("a pending command created after start is dispatched", async () => {
  const dispatched: [string, string][] = [];
  const engine = { dispatch: async (n: string, id: string) => void dispatched.push([n, id]) } as unknown as Engine;
  const trigger = startSubscriptionTrigger(adminIC(), engine, [sortear], { resubscribeEveryMs: 600_000 }, () => {});
  try {
    const org = await novoUsuario(PREFIXO);
    const grupoId = await criarGrupo(PREFIXO, org);
    const id = await sendCommand(org.db, sortear, { rodada: 1, chave: `${PREFIXO}-${crypto.randomUUID()}`, grupo: grupoId });
    await esperarAte(async () => dispatched.some(([, d]) => d === id), 15_000);
    expect(dispatched.find(([, d]) => d === id)?.[0]).toBe("sortear");
  } finally {
    trigger.stop();
  }
});
