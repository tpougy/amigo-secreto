// ensureWebhook against the real webhook manager of the test app.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { ensureWebhook } from "../../src/worker/webhook";
import { adminIC, novoPrefixo } from "../helpers";

setDefaultTimeout(30_000);

const PREFIXO = novoPrefixo("webhook");
const URL_ = `https://ic-teste.app.tpou.gy/ic/hook?run=${PREFIXO}`;
const admin = adminIC();
const manager = () => (admin as any).webhooks.manager;

beforeAll(async () => {
  const limite = Date.now() - 60 * 60 * 1000;
  for (const w of await manager().list()) {
    const m = /\?run=t([0-9a-z]+)-/.exec(w.sink.url);
    if (m && parseInt(m[1]!, 36) < limite) await manager().delete(w.id);
  }
});

afterAll(async () => {
  for (const w of await manager().list()) if (w.sink.url === URL_) await manager().delete(w.id);
});

test("ensureWebhook round-trip on the real manager", async () => {
  const id = await ensureWebhook(admin as any, URL_, ["grupos"], () => {});
  const find = async () => (await manager().list()).find((w: any) => w.id === id);
  const w = await find();
  expect(w.sink.url).toBe(URL_);
  expect(w.namespaces).toEqual(["grupos"]);
  expect(w.actions).toEqual(["create"]);
  expect(await ensureWebhook(admin as any, URL_, ["grupos", "$users"], () => {})).toBe(id);
  expect([...(await find()).namespaces].sort()).toEqual(["$users", "grupos"]);
  expect(await ensureWebhook(admin as any, URL_, ["grupos", "$users"], () => {})).toBe(id);
});
