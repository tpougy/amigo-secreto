import { afterAll, describe, expect, test } from "bun:test";
import exemplo from "./exemplo.json";
import { lerSeed } from "./esquema";
import { adminDe, semear } from "./seed";

describe("esquema", () => {
  const base = () => structuredClone(exemplo) as any;
  test("exemplo é válido", () => expect(() => lerSeed(base())).not.toThrow());
  test("erros apontam o caminho", () => {
    const s = base();
    s.grupos[0].codigo = "ABC0EF";
    s.grupos[0].organizador = "nao-e-email";
    let msg = "";
    try {
      lerSeed(s);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("grupos.0.codigo");
    expect(msg).toContain("grupos.0.organizador");
    const t = base();
    t.grupos[0].tema = "inexistente";
    expect(() => lerSeed(t)).toThrow("grupos.0.tema");
    const r = base();
    r.grupos[0].participantes[0].respostas["Gêneros que mais gosto"] = ["xyz"];
    expect(() => lerSeed(r)).toThrow("grupos.0.participantes.0.respostas.Gêneros que mais gosto");
  });
});

describe("semear (app de teste)", () => {
  const db = adminDe("teste");
  const codigo = "TSD" + "KMN".split("").sort(() => Math.random() - 0.5).join("");
  const seed = lerSeed({ grupos: [{ ...(exemplo as any).grupos[0], codigo, titulo: "Seed teste" }] });
  const emails = seed.grupos[0]!.participantes.map((p) => p.email);

  async function contar() {
    const { grupos } = await db.query({
      grupos: { $: { where: { codigo } }, campos: {}, participantes: { respostas: {} } },
    });
    return {
      grupos: grupos.length,
      campos: grupos[0]?.campos.length,
      participantes: grupos[0]?.participantes.length,
      respostas: grupos[0]?.participantes.reduce((n, p) => n + p.respostas.length, 0),
    };
  }

  afterAll(async () => {
    const { grupos } = await db.query({ grupos: { $: { where: { codigo } } } });
    if (grupos.length) await db.transact(grupos.map((g) => db.tx.grupos[g.id]!.delete()));
    for (const email of emails) {
      const u = await db.auth.getUser({ email }).catch(() => null);
      if (u) await db.auth.deleteUser({ id: u.id });
    }
  });

  test("rodar duas vezes mantém as mesmas contagens", async () => {
    await semear(db, seed);
    const a = await contar();
    expect(a).toEqual({ grupos: 1, campos: 4, participantes: 5, respostas: 6 });
    await semear(db, seed);
    expect(await contar()).toEqual(a);
  }, 60000);
});
