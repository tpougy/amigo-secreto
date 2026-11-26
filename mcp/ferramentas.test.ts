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
  pedirReabertura,
  simularReabertura,
  simularWorker,
  type Usuario,
} from "@amigo/instant/teste";
import {
  atualizarResposta,
  editarCamposPerfil,
  editarGrupo,
  painelGrupo,
  ERRO_PERFIS_OCULTOS,
  meuAmigoSecreto,
  meuPerfil,
  meusGrupos,
  perfilParticipante,
} from "./ferramentas";

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
        .create({ status: "running", rodada: 1, chave: `${grupoId}:1`, attempts: 0, createdAt: Date.now() })
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

  test("com a rodada 2 pending/running: aviso de refazendo, sem par e sem marcar viuParNaRodada", async () => {
    const sorteio2 = id();
    await admin.transact(
      admin.tx.sorteios[sorteio2]!
        .create({ status: "pending", rodada: 2, chave: `${grupoId}:2`, attempts: 0, createdAt: Date.now() })
        .link({ grupo: grupoId }),
    );
    // B "ainda não viu": a chamada durante o refazer não pode marcar.
    await admin.transact(admin.tx.participantes[part.B!]!.update({ viuParNaRodada: null }));
    try {
      for (const status of ["pending", "running"]) {
        await admin.transact(admin.tx.sorteios[sorteio2]!.update({ status }));
        expect(await meuAmigoSecreto(B.db, codigo)).toEqual({
          aviso: "O sorteio está sendo refeito. Tente de novo em instantes.",
        });
      }
      const { participantes } = await admin.query({ participantes: { $: { where: { id: part.B! } } } });
      expect(participantes[0]!.viuParNaRodada ?? null).toBeNull();
    } finally {
      await admin.transact(admin.tx.sorteios[sorteio2]!.delete());
    }
    // Sem o sorteio em andamento, volta a devolver o par.
    expect(await meuAmigoSecreto(B.db, codigo)).toMatchObject({ apelido: apelido(C) });
  });
});

describe("depois de reabrir o grupo", () => {
  beforeAll(async () => {
    await pedirReabertura(O, grupoId);
    await simularReabertura(admin, grupoId);
  }, 30_000);

  test("meuAmigoSecreto avisa que o sorteio ainda não aconteceu (não há par)", async () => {
    for (const u of [O, A, B, C]) {
      expect(await meuAmigoSecreto(u.db, codigo)).toEqual({ aviso: "O sorteio ainda não aconteceu" });
    }
    const { grupos } = await admin.query({ grupos: { $: { where: { id: grupoId } } } });
    expect(grupos[0]).toMatchObject({ status: "aberto", rodadaAtual: 1, rodadaBase: 1 });
  });

  test("sorteio novo em andamento depois de reabrir: 'ainda não aconteceu', não 'sendo refeito'", async () => {
    const sorteio2 = id();
    await admin.transact(
      admin.tx.sorteios[sorteio2]!
        .create({ status: "pending", rodada: 2, chave: `${grupoId}:2`, attempts: 0, createdAt: Date.now() })
        .link({ grupo: grupoId }),
    );
    try {
      for (const status of ["pending", "running"]) {
        await admin.transact(admin.tx.sorteios[sorteio2]!.update({ status }));
        expect(await meuAmigoSecreto(A.db, codigo)).toEqual({ aviso: "O sorteio ainda não aconteceu" });
      }
    } finally {
      await admin.transact(admin.tx.sorteios[sorteio2]!.delete());
    }
  });
});

describe("perfil de outro participante", () => {
  let apelidoB: string;
  const ligar = (v: boolean) => O.db.transact(O.db.tx.grupos[grupoId]!.update({ perfisVisiveis: v }));

  beforeAll(async () => {
    const { participantes } = await admin.query({ participantes: { $: { where: { id: part.B! } } } });
    apelidoB = participantes[0]!.apelido;
  });

  test("com a opção desligada, recusa e aponta meu_amigo_secreto", async () => {
    expect(await perfilParticipante(C.db, codigo, apelidoB)).toEqual({ erro: ERRO_PERFIS_OCULTOS });
  });

  test("com a opção ligada, devolve rótulos e valores (apelido sem diferença de caixa), sem ids", async () => {
    await ligar(true);
    const r = await perfilParticipante(C.db, comRuido(codigo), ` ${apelidoB.toUpperCase()} `);
    expect(r).toEqual({
      apelido: apelidoB,
      respostas: expect.arrayContaining([
        { rotulo: GENEROS, valor: ["poesia"] },
        { rotulo: LIDOS, valor: ["segredo-de-B"] },
      ]),
    });
    expect("respostas" in r && r.respostas).toHaveLength(2);
    expect(JSON.stringify(r)).not.toContain(part.B!);
  });

  test("apelido desconhecido lista os participantes; quem não é do grupo não encontra o grupo", async () => {
    const r = await perfilParticipante(C.db, codigo, "ninguém");
    expect("erro" in r && r.erro).toStartWith("Participante não encontrado. Participantes: ");
    expect("erro" in r && r.erro).toContain(apelidoB);
    const estranho = await criarUsuario(prefixo);
    expect(await perfilParticipante(estranho.db, codigo, apelidoB)).toEqual({ erro: "Grupo não encontrado" });
  });

  test("desligar de novo volta a recusar", async () => {
    await ligar(false);
    expect(await perfilParticipante(C.db, codigo, apelidoB)).toEqual({ erro: ERRO_PERFIS_OCULTOS });
  });
});

describe("organizador", () => {
  const SO_ORGANIZADOR = "Só o organizador do grupo pode fazer isso";
  const camposAtuais = async () => {
    const { campos } = await admin.query({ campos: { $: { where: { "grupo.id": grupoId } } } });
    return campos.sort((a, b) => a.ordem - b.ordem).map((c) => ({ rotulo: c.rotulo, tipo: c.tipo, ordem: c.ordem }));
  };

  test("painel_grupo: o organizador vê grupo, participantes e campos, sem ids; participante não", async () => {
    const p = await painelGrupo(O.db, comRuido(codigo));
    if ("erro" in p) throw new Error(p.erro);
    expect(p.codigo).toBe(formatarCodigo(codigo));
    expect(p.participantes).toHaveLength(4);
    expect(p.participantes[0]).toEqual({ apelido: expect.any(String), perfilCompleto: expect.any(Boolean), removido: false });
    expect(p.campos.map((c) => c.rotulo)).toEqual([LIDOS, GENEROS]); // ordem do tema no grupo de teste
    expect(JSON.stringify(p)).not.toContain(grupoId);
    expect(await painelGrupo(A.db, codigo)).toEqual({ erro: SO_ORGANIZADOR });
  });

  test("editar_grupo: muda só o que vier, valida o estado final e recusa quem não organiza", async () => {
    expect(
      await editarGrupo(O.db, codigo, {
        titulo: "  Amigo dos livros  ",
        dataSorteioPrevista: "2026-12-10",
        dataEvento: "2026-12-20",
        valorSugerido: 80,
        perfisVisiveis: true,
      }),
    ).toEqual({ ok: true });
    const { grupos } = await admin.query({ grupos: { $: { where: { id: grupoId } } } });
    expect(grupos[0]).toMatchObject({ titulo: "Amigo dos livros", valorSugerido: 80, perfisVisiveis: true });
    const p = await painelGrupo(O.db, codigo);
    expect(p).toMatchObject({ dataSorteioPrevista: "2026-12-10", dataEvento: "2026-12-20" });

    expect(await editarGrupo(O.db, codigo, { dataEvento: "2026-12-01" })).toEqual({
      erro: "A data do evento não pode ser anterior à data prevista do sorteio.",
    });
    expect(await editarGrupo(O.db, codigo, { titulo: "ab" })).toEqual({ erro: "O título precisa ter de 3 a 80 caracteres." });
    expect(await editarGrupo(O.db, codigo, { valorSugerido: null, descricao: null })).toEqual({ ok: true });
    expect(await editarGrupo(A.db, codigo, { titulo: "Invasão" })).toEqual({ erro: SO_ORGANIZADOR });
    const depois = await admin.query({ grupos: { $: { where: { id: grupoId } } } });
    expect(depois.grupos[0]).toMatchObject({ titulo: "Amigo dos livros" });
    expect(depois.grupos[0]!.valorSugerido ?? null).toBeNull();
  });

  test("editar_campos_perfil: renomeia, cria e reordena; remover exige confirmação", async () => {
    // Remover LIDOS sem confirmar: erro e nada muda.
    const semConfirmar = await editarCamposPerfil(O.db, codigo, [
      { rotulo: GENEROS, tipo: "multipla", obrigatorio: true, opcoes: ["fantasia", "poesia", "suspense"] },
    ]);
    expect("erro" in semConfirmar && semConfirmar.erro).toContain(LIDOS);
    expect((await camposAtuais()).map((c) => c.rotulo)).toEqual([LIDOS, GENEROS]);

    // Opção insuficiente: erro de validação.
    expect(
      await editarCamposPerfil(O.db, codigo, [
        { rotulo: GENEROS, tipo: "multipla", obrigatorio: true, opcoes: ["fantasia"] },
        { rotulo: LIDOS, tipo: "lista", obrigatorio: false },
      ]),
    ).toEqual({ erro: `Campo 1 (${GENEROS}): informe pelo menos 2 opções.` });

    // Renomeia LIDOS (via rotuloAtual), cria um novo no topo e mantém GENEROS (rótulo com outra caixa).
    const r = await editarCamposPerfil(O.db, codigo, [
      { rotulo: "Formato preferido", tipo: "unica", obrigatorio: false, opcoes: ["papel", "e-book"] },
      { rotulo: GENEROS.toUpperCase(), tipo: "multipla", obrigatorio: true, opcoes: ["fantasia", "poesia"] },
      { rotuloAtual: LIDOS, rotulo: "Livros que já tenho", tipo: "lista", obrigatorio: false, ajuda: "Para não repetir" },
    ]);
    expect(r).toEqual({ ok: true, campos: ["Formato preferido", GENEROS.toUpperCase(), "Livros que já tenho"], removidos: [] });
    expect(await camposAtuais()).toEqual([
      { rotulo: "Formato preferido", tipo: "unica", ordem: 0 },
      { rotulo: GENEROS.toUpperCase(), tipo: "multipla", ordem: 1 },
      { rotulo: "Livros que já tenho", tipo: "lista", ordem: 2 },
    ]);
    // A resposta de B ao campo renomeado continua lá (mesmo campo).
    const { respostas } = await admin.query({ respostas: { $: { where: { "participante.id": part.B! } }, campo: {} } });
    expect(respostas.some((x) => x.campo?.rotulo === "Livros que já tenho")).toBe(true);

    // Com confirmação, remove.
    const removido = await editarCamposPerfil(
      O.db,
      codigo,
      [{ rotulo: "Formato preferido", tipo: "unica", obrigatorio: false, opcoes: ["papel", "e-book"] }],
      true,
    );
    expect(removido).toEqual({
      ok: true,
      campos: ["Formato preferido"],
      removidos: [GENEROS.toUpperCase(), "Livros que já tenho"],
    });
    expect(await editarCamposPerfil(A.db, codigo, [])).toEqual({ erro: SO_ORGANIZADOR });
  });
});
