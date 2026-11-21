import { describe, expect, spyOn, test } from "bun:test";
import { id } from "@instantdb/admin";
import { adminTeste } from "@amigo/instant/teste";
import { assinaturaInstant, iniciarCampainha, type Assinatura } from "./campainha";

type Item = { id: string; segredo?: string };

/** Assinatura falsa e controlável: guarda cada abertura e permite entregar/falhar. */
function fake() {
  const aberturas: {
    receber: (i: Item[]) => void;
    erro: (e: unknown) => void;
    fechada: boolean;
  }[] = [];
  const assinar: Assinatura<Item> = (receber, erro) => {
    const a = { receber, erro, fechada: false };
    aberturas.push(a);
    return { fechar: () => void (a.fechada = true) };
  };
  return { aberturas, assinar };
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const montar = (f: ReturnType<typeof fake>, extra: Partial<Parameters<typeof iniciarCampainha<Item>>[0]> = {}) => {
  const chamadas: [Item, string][] = [];
  const c = iniciarCampainha<Item>({
    nome: "teste",
    assinar: f.assinar,
    chave: (i) => `k:${i.id}`,
    disparar: async (i, k) => void chamadas.push([i, k]),
    backoffMs: [10, 20],
    ...extra,
  });
  return { c, chamadas };
};

describe("campainha", () => {
  test("entrega [a,b] dispara 2 vezes com as chaves certas", async () => {
    const f = fake();
    const { c, chamadas } = montar(f);
    f.aberturas[0]!.receber([{ id: "a" }, { id: "b" }]);
    await esperar(5);
    expect(chamadas.map(([, k]) => k)).toEqual(["k:a", "k:b"]);
    c.parar();
  });

  test("erro fecha e reassina após 10 ms, depois 20 ms; itens pós-reconexão disparam", async () => {
    const f = fake();
    const { c, chamadas } = montar(f);
    const t0 = performance.now();
    f.aberturas[0]!.erro(new Error("x"));
    expect(f.aberturas[0]!.fechada).toBe(true);
    expect(f.aberturas.length).toBe(1);
    await esperar(40);
    expect(f.aberturas.length).toBe(2);
    // segundo erro sem entrega entre eles: espera 20 ms
    f.aberturas[1]!.erro(new Error("y"));
    await esperar(8);
    expect(f.aberturas.length).toBe(2);
    await esperar(40);
    expect(f.aberturas.length).toBe(3);
    expect(f.aberturas[1]!.fechada).toBe(true);
    f.aberturas[2]!.receber([{ id: "p" }]);
    await esperar(5);
    expect(chamadas.map(([, k]) => k)).toEqual(["k:p"]);
    expect(performance.now() - t0).toBeLessThan(500);
    c.parar();
  });

  test("backoff zera na primeira entrega bem-sucedida", async () => {
    const f = fake();
    const { c } = montar(f);
    f.aberturas[0]!.erro(1);
    await esperar(40);
    f.aberturas[1]!.erro(2);
    await esperar(40);
    f.aberturas[2]!.receber([]); // entrega ok: zera
    f.aberturas[2]!.erro(3);
    await esperar(15); // 10 ms (zerado), não 20 nem 20+
    expect(f.aberturas.length).toBe(4);
    c.parar();
  });

  test("erros repetidos antes de reassinar não agendam reassinaturas duplicadas", async () => {
    const f = fake();
    const { c } = montar(f);
    f.aberturas[0]!.erro(1);
    f.aberturas[0]!.erro(2);
    await esperar(60);
    expect(f.aberturas.length).toBe(2);
    c.parar();
  });

  test("disparar que rejeita não impede o próximo item nem derruba a campainha", async () => {
    const f = fake();
    const vistos: string[] = [];
    const { c } = montar(f, {
      disparar: async (i) => {
        vistos.push(i.id);
        if (i.id === "a") throw new Error("falhou");
      },
    });
    f.aberturas[0]!.receber([{ id: "a" }, { id: "b" }]);
    await esperar(5);
    expect(vistos).toEqual(["a", "b"]);
    f.aberturas[0]!.receber([{ id: "c" }]);
    await esperar(5);
    expect(vistos).toEqual(["a", "b", "c"]);
    expect(f.aberturas.length).toBe(1);
    c.parar();
  });

  test("assinar que lança síncrono é tratado como erro e reassina", async () => {
    let n = 0;
    const abertas: number[] = [];
    const c = iniciarCampainha<Item>({
      nome: "t",
      assinar: () => {
        abertas.push(++n);
        if (n === 1) throw new Error("sem rede");
        return { fechar() {} };
      },
      chave: (i) => i.id,
      disparar: async () => {},
      backoffMs: [10],
    });
    await esperar(40);
    expect(abertas.length).toBe(2);
    c.parar();
  });

  test("parar() fecha a assinatura e não reassina mais", async () => {
    const f = fake();
    const { c, chamadas } = montar(f);
    f.aberturas[0]!.erro(1);
    c.parar();
    await esperar(40);
    expect(f.aberturas.length).toBe(1);
    expect(f.aberturas[0]!.fechada).toBe(true);
    f.aberturas[0]!.receber([{ id: "z" }]);
    await esperar(5);
    expect(chamadas.length).toBe(0);
  });

  test("parar() com assinatura ativa a fecha", () => {
    const f = fake();
    const { c } = montar(f);
    c.parar();
    expect(f.aberturas[0]!.fechada).toBe(true);
  });

  test("logs não contêm valores dos itens além da chave", async () => {
    const f = fake();
    const linhas: string[] = [];
    const spy = spyOn(console, "log").mockImplementation((s: unknown) => void linhas.push(String(s)));
    const stdout = spyOn(process.stdout, "write").mockImplementation(((s: unknown) => {
      linhas.push(String(s));
      return true;
    }) as never);
    try {
      const { c } = montar(f, {
        disparar: async () => {
          throw new Error("boom");
        },
      });
      f.aberturas[0]!.receber([{ id: "a", segredo: "NOME-SECRETO-JOAO" }]);
      await esperar(5);
      f.aberturas[0]!.erro(new Error("NOME-SECRETO-JOAO"));
      await esperar(30);
      c.parar();
    } finally {
      spy.mockRestore();
      stdout.mockRestore();
    }
    const todo = linhas.join("\n");
    expect(todo.length).toBeGreaterThan(0);
    expect(todo).not.toContain("NOME-SECRETO-JOAO");
    for (const l of linhas.join("").split("\n").filter(Boolean)) JSON.parse(l);
  });
});

describe("assinaturaInstant (app de teste)", () => {
  test("recebe um item criado via transact admin", async () => {
    const db = adminTeste();
    const grupoId = id();
    const codigo = `W${Date.now().toString(36)}`.toUpperCase();
    const recebidos: string[][] = [];
    const sub = assinaturaInstant(db, { grupos: { $: { where: { codigo } } } })(
      (itens: any[]) => void recebidos.push(itens.map((i) => i.id)),
      (e) => {
        throw e;
      },
    );
    try {
      await db.transact(
        db.tx.grupos[grupoId]!.update({
          titulo: "campainha",
          tema: "x",
          codigo,
          status: "aberto",
          rodadaAtual: 0,
          criadoEm: new Date().toISOString(),
        }),
      );
      const limite = Date.now() + 15_000;
      while (!recebidos.some((r) => r.includes(grupoId)) && Date.now() < limite) await esperar(100);
      expect(recebidos.some((r) => r.includes(grupoId))).toBe(true);
    } finally {
      sub.fechar();
      await db.transact(db.tx.grupos[grupoId]!.delete());
    }
  }, 30_000);
});
