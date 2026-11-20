// Ferramentas do MCP contra o app de TESTE, cada uma chamada com o `db` impersonado (`asUser`).
// Rodar da raiz: `bun test mcp/` (o Bun carrega o .env da raiz).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { id } from "@instantdb/admin";
import { formatarCodigo } from "@amigo/dominio";
import {
  adminTeste,
  criarGrupoTeste,
  criarUsuario,
  entrar,
  limparTudo,
  novoPrefixo,
  simularWorker,
  type Usuario,
} from "../testes/instant-teste";
import { atualizarResposta, meuAmigoSecreto, meuPerfil, meusGrupos } from "./ferramentas";

const admin = adminTeste();
const prefixo = novoPrefixo("mcp");

const GENEROS = "Gêneros que mais gosto";
const LIDOS = "Livros que li recentemente"; // lista, opcional (criarGrupoTeste cria só os 2 primeiros campos do tema)

let O: Usuario, A: Usuario, B: Usuario, C: Usuario;
let grupoId: string, codigo: string, grupoDeAId: string;
const part: Record<string, string> = {};

/** Código como alguém digitaria: minúsculo, com hífen e espaços. */
const comRuido = (c: string) => ` ${formatarCodigo(c).toLowerCase()} `;

beforeAll(async () => {
  [O, A, B, C] = await Promise.all([1, 2, 3, 4].map(() => criarUsuario(prefixo)));
  ({ grupoId, codigo } = await criarGrupoTeste(O!, { titulo: `${prefixo} principal`, organizadorParticipa: true }));
  ({ grupoId: grupoDeAId } = await criarGrupoTeste(A!, { titulo: `${prefixo} de A` }));
  const { participantes } = await admin.query({
    participantes: { $: { where: { "grupo.id": grupoId } }, usuario: {} },
  });
  part.O = participantes.find((p) => p.usuario?.id === O!.id)!.id;
  part.A = await entrar(A!, grupoId, codigo);
  part.B = await entrar(B!, grupoId, codigo);
  part.C = await entrar(C!, grupoId, codigo);
}, 30_000);

afterAll(async () => {
  await limparTudo(prefixo);
}, 30_000);

describe("antes do sorteio", () => {
  test("meusGrupos separa organizando e participando", async () => {
    const deO = await meusGrupos(O.db);
    expect(deO.organizando.map((g) => g.id)).toEqual([grupoId]);
    expect(deO.participando.map((g) => g.id)).toEqual([grupoId]);
    expect(deO.organizando[0]!.codigo).toBe(formatarCodigo(codigo));

    const deA = await meusGrupos(A.db);
    expect(deA.organizando.map((g) => g.id)).toEqual([grupoDeAId]);
    expect(deA.participando.map((g) => g.id)).toEqual([grupoId]);
  });

  test("meuAmigoSecreto devolve o aviso", async () => {
    expect(await meuAmigoSecreto(A.db, comRuido(codigo))).toEqual({
      aviso: "O sorteio ainda não aconteceu",
    });
  });

  test("grupo de que não participo (ou lixo) não é encontrado", async () => {
    expect(await meuPerfil(B.db, grupoDeAId)).toEqual({ erro: "Grupo não encontrado" });
    expect(await meuAmigoSecreto(A.db, grupoDeAId)).toEqual({ erro: "Você não participa deste grupo" });
    expect(await meuPerfil(A.db, "0OO-1II")).toEqual({ erro: "Grupo não encontrado" });
  });

  test("atualizarResposta com opção inválida devolve o erro", async () => {
    expect(await atualizarResposta(B.db, codigo, GENEROS, ["fantasia", "culinária"])).toEqual({
      erro: "Opção inválida",
    });
    expect(await atualizarResposta(B.db, codigo, "Campo que não existe", "x")).toEqual({
      erro: 'Campo "Campo que não existe" não existe neste grupo',
    });
  });

  test("resposta válida grava como o próprio usuário e recalcula perfilCompleto", async () => {
    expect(await atualizarResposta(B.db, codigo, "gêneros que mais gosto ", ["fantasia", "poesia"])).toEqual({
      ok: true,
    });
    expect(await atualizarResposta(B.db, comRuido(codigo), LIDOS, ["segredo-de-B"])).toEqual({ ok: true });
    // Update da resposta existente (não cria outra).
    expect(await atualizarResposta(B.db, grupoId, GENEROS, ["poesia"])).toEqual({ ok: true });

    // B vê as próprias respostas pelo asUser; C não vê nenhuma de B.
    const deB = await B.db.query({ respostas: { $: { where: { "participante.id": part.B! } }, campo: {} } });
    expect(deB.respostas.map((r) => [r.campo?.rotulo, r.valor]).sort()).toEqual([
      [GENEROS, ["poesia"]],
      [LIDOS, ["segredo-de-B"]],
    ]);
    const deC = await C.db.query({ respostas: { $: { where: { "participante.id": part.B! } } } });
    expect(deC.respostas).toEqual([]);

    const { participantes } = await admin.query({ participantes: { $: { where: { id: part.B! } } } });
    expect(participantes[0]!.perfilCompleto).toBe(true);

    const perfil = await meuPerfil(B.db, codigo);
    if ("erro" in perfil) throw new Error(perfil.erro);
    expect(perfil.campos.find((c) => c.rotulo === GENEROS)).toMatchObject({
      tipo: "multipla",
      valor: ["poesia"],
      obrigatorio: true,
    });
    expect(perfil.campos.find((c) => c.rotulo === LIDOS)?.valor).toEqual(["segredo-de-B"]);
  });

  test("esvaziar um campo obrigatório é recusado; um opcional apaga a resposta", async () => {
    expect(await atualizarResposta(B.db, codigo, GENEROS, [])).toEqual({ erro: "Campo obrigatório" });
    await atualizarResposta(C.db, codigo, GENEROS, ["romance"]);
    await atualizarResposta(C.db, codigo, LIDOS, ["segredo-de-C"]);
    expect(await atualizarResposta(C.db, codigo, LIDOS, ["  ", ""])).toEqual({ ok: true });
    const perfil = await meuPerfil(C.db, codigo);
    if ("erro" in perfil) throw new Error(perfil.erro);
    expect(perfil.campos.find((c) => c.rotulo === LIDOS)?.valor).toBeUndefined();
    await atualizarResposta(C.db, codigo, LIDOS, ["segredo-de-C"]);
  });
});

describe("depois do sorteio", () => {
  // O→A, A→B, B→C, C→O
  const receptorDe: Record<string, string> = { O: "A", A: "B", B: "C", C: "O" };
  const usuarios = () => ({ O, A, B, C }) as Record<string, Usuario>;
  const apelido = (u: Usuario) => u.email.split("@")[0]!;

  beforeAll(async () => {
    const sorteioId = id();
    await admin.transact(
      admin.tx.sorteios[sorteioId]!
        .create({ status: "processando", rodada: 1, chave: `${grupoId}:1`, criadoEm: Date.now() })
        .link({ grupo: grupoId }),
    );
    await simularWorker(
      admin,
      sorteioId,
      Object.entries(receptorDe).map(([d, r]) => ({ doador: part[d]!, receptor: part[r]! })),
    );
  }, 30_000);

  test("meuAmigoSecreto como A devolve só o receptor de A, com rótulos e sem ids", async () => {
    const r = await meuAmigoSecreto(A.db, comRuido(codigo));
    expect(r).toEqual({
      apelido: apelido(B),
      respostas: [
        { rotulo: LIDOS, valor: ["segredo-de-B"] },
        { rotulo: GENEROS, valor: ["poesia"] },
      ],
    });
    const json = JSON.stringify(r);
    for (const p of Object.values(part)) expect(json).not.toContain(p);
  });

  test("como O devolve o par de O, não o de A", async () => {
    const r = await meuAmigoSecreto(O.db, codigo);
    expect(r).toMatchObject({ apelido: apelido(A) });
  });

  test("ninguém obtém o par (nem as respostas do par) de outra pessoa por nenhuma ferramenta", async () => {
    const todos = usuarios();
    for (const [nome, u] of Object.entries(todos)) {
      const amigo = await meuAmigoSecreto(u.db, codigo);
      expect(amigo).toMatchObject({ apelido: apelido(todos[receptorDe[nome]!]!) });

      const saidas = JSON.stringify([
        amigo,
        await meusGrupos(u.db),
        await meuPerfil(u.db, codigo),
        await meuPerfil(u.db, grupoDeAId),
      ]);
      // Respostas de B só aparecem para B (perfil) e para quem tirou B (A); idem C (B).
      expect(saidas.includes("segredo-de-B")).toBe(nome === "B" || nome === "A");
      expect(saidas.includes("segredo-de-C")).toBe(nome === "C" || nome === "B");
      // Nenhum outro apelido de participante aparece além do próprio receptor.
      for (const [outro, v] of Object.entries(todos)) {
        if (outro === receptorDe[nome]) continue;
        expect(saidas.includes(`"apelido":"${apelido(v)}"`)).toBe(false);
      }
    }
  }, 30_000);

  test("ver o par pelo MCP marca viuParNaRodada", async () => {
    const { participantes } = await admin.query({ participantes: { $: { where: { id: part.A! } } } });
    expect(participantes[0]!.viuParNaRodada).toBe(1);
  });
});
