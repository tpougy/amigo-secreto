// Spike descartável: cadastra webhook no app de teste e provoca entregas (update em id novo e create).
// Uso: provocar.sh [provocar|limpar]. Estado do webhook em /tmp/hairpin-webhook-id.
import { id } from "@instantdb/admin";
import { adminTeste, criarUsuario, limparTudo, novoPrefixo } from "@amigo/instant/teste";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";

const ESTADO = "/tmp/hairpin-webhook-id";
const URL_ECO = "https://ic-eco.app.tpou.gy/ic/hook";
const a = adminTeste();
const modo = process.argv[2] ?? "provocar";

if (modo === "limpar") {
  if (existsSync(ESTADO)) {
    await a.webhooks.manager.delete(readFileSync(ESTADO, "utf8").trim());
    rmSync(ESTADO);
    console.log("webhook apagado");
  } else console.log("sem webhook");
  process.exit(0);
}

let whId: string;
if (existsSync(ESTADO)) whId = readFileSync(ESTADO, "utf8").trim();
else {
  const w = await a.webhooks.manager.create({ url: URL_ECO, namespaces: ["grupos"], actions: ["create", "update"] });
  whId = w.id;
  writeFileSync(ESTADO, whId);
  console.log("webhook criado", whId, "status", w.status);
}

const prefixo = novoPrefixo("hairpin");
const org = await criarUsuario(prefixo);
const grava = (metodo: "update" | "create") => {
  const g = id();
  return a.transact(
    a.tx.grupos[g]![metodo]({ titulo: `${prefixo}-${metodo}`, tema: "livro", codigo: g.slice(0, 6), status: "aberto", rodadaAtual: 0, criadoEm: Date.now() }).link({ organizador: org.id }),
  );
};
try {
  await grava("update");
  await grava("create");
  await new Promise((r) => setTimeout(r, 8000));
  const { events } = await a.webhooks.manager.listEvents(whId);
  for (const e of events) {
    const p = (await a.webhooks.manager.getPayload(whId, e.isn)) as any;
    const resumo = JSON.stringify(p).replace(/"(token|secret)":"[^"]*"/g, "");
    console.log(e.isn, e.status, "tentativas:", JSON.stringify(e.attempts?.map((t) => t.statusCode)), resumo.slice(0, 400));
  }
} finally {
  await limparTudo(prefixo);
}
