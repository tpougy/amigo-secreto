// `reprocessar` direto, contra o app de TESTE do Instant (sem runner). Pedidos `failed` escritos
// pelo admin com os campos padrão; cada teste confere só o próprio usuário.
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { id } from "@instantdb/admin";
import { adminTeste, criarUsuario, limparTudo, novoPrefixo } from "@amigo/instant/teste";
import { reprocessar } from "./reprocessarExclusoes";

setDefaultTimeout(60_000);

const PREFIXO = novoPrefixo("worker-reprocessar");
const admin = adminTeste();
const criados: string[] = [];

afterAll(async () => {
  if (criados.length) await admin.transact(criados.map((p) => admin.tx.pedidosExclusao[p]!.delete()));
  await limparTudo(PREFIXO);
});

async function pedido(usuarioId: string, status: "pending" | "running" | "done" | "failed") {
  const pid = id();
  criados.push(pid);
  await admin.transact(
    admin.tx.pedidosExclusao[pid]!
      .create({
        status,
        attempts: status === "failed" ? 3 : 0,
        createdAt: Date.now(),
        error: status === "failed" ? "Não foi possível apagar a conta." : null,
        result: null,
        finishedAt: status === "failed" || status === "done" ? Date.now() : null,
      })
      .link({ usuario: usuarioId }),
  );
  return pid;
}

const pedidosDe = async (usuarioId: string) =>
  (await admin.query({ pedidosExclusao: { $: { where: { "usuario.id": usuarioId } } } })).pedidosExclusao;

describe("reprocessar", () => {
  test("cria um pedido novo pending para usuário com 1 failed e nada aberto", async () => {
    const u = await criarUsuario(PREFIXO);
    await pedido(u.id, "failed");
    const r = await reprocessar(admin);
    expect(r.criados).toBeGreaterThanOrEqual(1);
    const ps = await pedidosDe(u.id);
    expect(ps).toHaveLength(2);
    const novo = ps.find((p) => p.status === "pending")!;
    criados.push(novo.id);
    expect(novo.attempts).toBe(0);
    expect(typeof novo.createdAt).toBe("number");
    const { pedidosExclusao } = await admin.query({ pedidosExclusao: { $: { where: { id: novo.id } }, usuario: {} } });
    expect(pedidosExclusao[0]!.usuario?.id).toBe(u.id);
    // Rodar de novo não cria outro: agora há um pending.
    await reprocessar(admin);
    expect(await pedidosDe(u.id)).toHaveLength(2);
  });

  test("não cria se o usuário já tem pedido pending, running ou done", async () => {
    const us = await Promise.all([1, 2, 3].map(() => criarUsuario(PREFIXO)));
    const abertos = ["pending", "running", "done"] as const;
    for (const [i, u] of us.entries()) {
      await pedido(u.id, "failed");
      await pedido(u.id, abertos[i]!);
    }
    await reprocessar(admin);
    for (const u of us) expect(await pedidosDe(u.id)).toHaveLength(2);
  });

  test("desiste com 3 failed", async () => {
    const u = await criarUsuario(PREFIXO);
    for (let i = 0; i < 3; i++) await pedido(u.id, "failed");
    const r = await reprocessar(admin);
    expect(r.desistiu).toBeGreaterThanOrEqual(1);
    const ps = await pedidosDe(u.id);
    expect(ps).toHaveLength(3);
    expect(ps.every((p) => p.status === "failed")).toBe(true);
  });

  test("ignora failed cujo usuário não existe mais", async () => {
    const u = await criarUsuario(PREFIXO);
    const pid = await pedido(u.id, "failed");
    await admin.auth.deleteUser({ id: u.id });
    // Guarda o que `reprocessar` escreve: nenhuma escrita pode citar este usuário.
    const escritas: string[] = [];
    const espiao = new Proxy(admin, {
      get(t, k) {
        const v = Reflect.get(t, k, t);
        if (k === "transact") {
          return (chunks: unknown) => {
            escritas.push(JSON.stringify(chunks));
            return t.transact(chunks as never);
          };
        }
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    await reprocessar(espiao);
    expect(escritas.filter((e) => e.includes(u.id))).toEqual([]);
    const { pedidosExclusao } = await admin.query({ pedidosExclusao: { $: { where: { id: pid } }, usuario: {} } });
    expect(pedidosExclusao).toHaveLength(1);
    expect(pedidosExclusao[0]!.usuario).toBeFalsy();
  });
});
