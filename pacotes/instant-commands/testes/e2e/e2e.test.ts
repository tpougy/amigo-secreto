// E2E of the webhook mode against the disposable Dokku app `ic-teste-worker` on the VPS.
// Skipped unless IC_E2E is set. Run with testes/e2e/rodar.sh.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { sendCommand, waitForCommand } from "../../src/client";
import { sortear } from "../app/commands";
import { adminIC, criarGrupo, limpar, limparRestos, novoPrefixo, novoUsuario } from "../helpers";

setDefaultTimeout(120_000);

const SKIP = !process.env.IC_E2E;
const APP = "ic-teste-worker";
const HOOK = `https://${APP}.app.tpou.gy/ic/hook`;
const PREFIXO = novoPrefixo("e2e");

async function dokku(...args: string[]): Promise<void> {
  const p = Bun.spawn(["ssh", "vps-mercurio", "dokku", ...args], { stdout: "ignore", stderr: "pipe" });
  const code = await p.exited;
  if (code !== 0) throw new Error(`dokku ${args.join(" ")} failed: ${await new Response(p.stderr).text()}`);
}

async function enviar() {
  const org = await novoUsuario(PREFIXO);
  const grupo = await criarGrupo(PREFIXO, org);
  const cid = await sendCommand(org.db, sortear, { rodada: 1, chave: `${PREFIXO}-${crypto.randomUUID()}`, grupo });
  return { org, cid };
}

async function statusDe(cid: string) {
  const { sorteios } = await adminIC().query({ sorteios: { $: { where: { id: cid } } } });
  return sorteios[0]?.status;
}

describe.skipIf(SKIP)("webhook mode on the VPS", () => {
  beforeAll(limparRestos);
  afterAll(async () => {
    // Leave the worker running even if the worker-down test failed midway.
    await dokku("ps:start", APP).catch(() => {});
    await limpar(PREFIXO);
  });

  test.skipIf(SKIP)("webhook: a command reaches done in under 10 s", async () => {
    const { org, cid } = await enviar();
    const t0 = Date.now();
    const state = await waitForCommand(org.db, sortear, cid, { timeoutMs: 10_000 });
    expect(state.status).toBe("done");
    expect(state.result).toEqual({ pares: 0 });
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  test.skipIf(SKIP)("worker down: command waits; after restart the startup sweep finishes it in under 30 s", async () => {
    await dokku("ps:stop", APP);
    const { org, cid } = await enviar();
    await new Promise((r) => setTimeout(r, 8_000));
    expect(await statusDe(cid)).toBe("pending");
    await dokku("ps:start", APP);
    const state = await waitForCommand(org.db, sortear, cid, { timeoutMs: 30_000 });
    expect(state.status).toBe("done");
  });

  test.skipIf(SKIP)("direct POST from the internet is refused", async () => {
    const res = await fetch(HOOK, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    expect(res.status).toBe(403);
  });
});
