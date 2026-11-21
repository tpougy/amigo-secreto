import { describe, expect, test } from "bun:test";
import { dadosParaPlano, montarExportacao, nomeArquivoExportacao, planoApagarConta, type DadosExportacao } from "./conta";

const campo = (id: string, rotulo: string, ordem: number) => ({ id, rotulo, tipo: "texto", obrigatorio: true, ordem });

/** Usuário "eu" com 2 participações (uma sorteada, uma aberta) e 1 grupo organizado. */
const dados: DadosExportacao = {
  id: "u-eu",
  email: "eu@exemplo.com",
  participacoes: [
    {
      id: "p-eu-1",
      apelido: "Eu",
      entrouEm: "2026-11-01T12:00:00.000Z",
      removido: false,
      grupo: {
        id: "g1",
        titulo: "Firma",
        status: "sorteado",
        rodadaAtual: 2,
        campos: [campo("c2", "Tamanho de camiseta", 1), campo("c1", "O que eu gosto", 0)],
        // Dados que NUNCA podem ir para a exportação (outras pessoas).
        participantes: [{ id: "p-outro-1", apelido: "Fulano" }, { id: "p-outro-2", apelido: "Beltrano" }],
      },
      respostas: [
        { id: "r1", valor: "M", campo: { id: "c2", rotulo: "Tamanho de camiseta" } },
        { id: "r2", valor: ["livros", "café"], campo: { id: "c1", rotulo: "O que eu gosto" } },
      ],
      doando: {
        sorteio: { rodada: 2 },
        receptor: {
          id: "p-recebe",
          apelido: "Ciclana",
          respostas: [{ id: "r-dela", valor: "segredo dela", campo: { id: "c1", rotulo: "O que eu gosto" } }],
          doando: { receptor: { id: "p-outro-2", apelido: "Beltrano" } },
        },
      },
    },
    {
      id: "p-eu-2",
      apelido: "Eu mesmo",
      entrouEm: 1793000000000,
      removido: false,
      grupo: { id: "g2", titulo: "Família", status: "aberto", rodadaAtual: 0, campos: [campo("c9", "Livro favorito", 0)] },
      respostas: [{ id: "r9", valor: "Dom Casmurro", campo: { id: "c9", rotulo: "Livro favorito" } }],
      doando: null,
    },
  ],
  gruposOrganizados: [
    {
      id: "g3",
      titulo: "Clube do livro",
      codigo: "KQ7M4P",
      status: "aberto",
      rodadaAtual: 0,
      campos: [campo("c5", "Gênero preferido", 0), { ...campo("c6", "Tamanho", 1), tipo: "unica", opcoes: ["P", "M"] }],
      participantes: [{ id: "p-outro-3", apelido: "Alguém" }],
    },
  ],
};

describe("montarExportacao", () => {
  const json = montarExportacao(dados, new Date("2026-11-20T10:00:00.000Z"));
  const texto = JSON.stringify(json);

  test("2 participações e 1 grupo organizado, com os rótulos dos campos", () => {
    expect(json.conta.email).toBe("eu@exemplo.com");
    expect(json.geradoEm).toBe("2026-11-20T10:00:00.000Z");
    expect(json.participacoes).toHaveLength(2);
    const [firma, familia] = json.participacoes;
    expect(firma!.grupo).toEqual({ id: "g1", titulo: "Firma", status: "sorteado" });
    // Na ordem dos campos (ordem 0, depois 1), com o rótulo.
    expect(firma!.respostas).toEqual([
      { campo: "O que eu gosto", valor: ["livros", "café"] },
      { campo: "Tamanho de camiseta", valor: "M" },
    ]);
    expect(firma!.quemEuTirei).toEqual({ participanteId: "p-recebe", apelido: "Ciclana" });
    expect(familia!.respostas).toEqual([{ campo: "Livro favorito", valor: "Dom Casmurro" }]);
    expect(familia!.quemEuTirei).toBeNull();
    expect(familia!.entrouEm).toBe(new Date(1793000000000).toISOString());

    expect(json.gruposOrganizados).toEqual([
      {
        id: "g3",
        titulo: "Clube do livro",
        codigo: "KQ7-M4P",
        status: "aberto",
        campos: [
          { rotulo: "Gênero preferido", tipo: "texto", obrigatorio: true },
          { rotulo: "Tamanho", tipo: "unica", obrigatorio: true, opcoes: ["P", "M"] },
        ],
      },
    ]);
  });

  test("nenhum id de participante além do próprio e do receptor do próprio par", () => {
    const ids = [...texto.matchAll(/"(p-[a-z0-9-]+)"/g)].map((m) => m[1]);
    expect(new Set(ids)).toEqual(new Set(["p-eu-1", "p-eu-2", "p-recebe"]));
    for (const proibido of ["p-outro-1", "p-outro-2", "p-outro-3", "Fulano", "Beltrano", "Alguém", "segredo dela"]) {
      expect(texto).not.toContain(proibido);
    }
  });

  test("par de uma rodada antiga não aparece como 'quem eu tirei'", () => {
    const antigo = structuredClone(dados);
    antigo.participacoes[0]!.doando!.sorteio = { rodada: 1 };
    expect(montarExportacao(antigo).participacoes[0]!.quemEuTirei).toBeNull();
  });

  test("participação removida não é exportada como ativa", () => {
    const r = structuredClone(dados);
    r.participacoes[1]!.removido = true;
    expect(montarExportacao(r).participacoes.map((p) => p.grupo.id)).toEqual(["g1"]);
  });

  test("nome do arquivo com a data", () => {
    expect(nomeArquivoExportacao(new Date("2026-11-20T10:00:00.000Z"))).toBe("amigo-secreto-meus-dados-2026-11-20.json");
  });
});

describe("dadosParaPlano + planoApagarConta", () => {
  test("distingue grupo sorteado (anonimizar) e aberto (apagar); o organizado some inteiro", () => {
    const ops = planoApagarConta(dadosParaPlano(dados));
    expect(ops).toEqual([
      { tipo: "anonimizar", participanteId: "p-eu-1", grupoId: "g1", rodada: 2, rodadaBase: 0, respostas: ["r1", "r2"] },
      { tipo: "apagar-participacao", participanteId: "p-eu-2", grupoId: "g2" },
      { tipo: "apagar-grupo", grupoId: "g3" },
      { tipo: "concluir-pedido" },
      { tipo: "apagar-usuario", usuarioId: "u-eu" },
    ]);
  });

  test("grupo reaberto (aberto, rodada >= 1) apaga a participação; rodadaBase segue para o semRefazer", () => {
    const g1 = dados.participacoes![0]!;
    const reaberto: DadosExportacao = {
      ...dados,
      participacoes: [{ ...g1, grupo: { ...g1.grupo!, status: "aberto", rodadaAtual: 2, rodadaBase: 2 } }],
      gruposOrganizados: [],
    };
    expect(planoApagarConta(dadosParaPlano(reaberto))[0]).toEqual({
      tipo: "apagar-participacao",
      participanteId: "p-eu-1",
      grupoId: "g1",
    });
    const sorteadoDeNovo: DadosExportacao = {
      ...reaberto,
      participacoes: [{ ...g1, grupo: { ...g1.grupo!, status: "sorteado", rodadaAtual: 3, rodadaBase: 2 } }],
    };
    expect(planoApagarConta(dadosParaPlano(sorteadoDeNovo))[0]).toMatchObject({ tipo: "anonimizar", rodada: 3, rodadaBase: 2 });
  });
});
