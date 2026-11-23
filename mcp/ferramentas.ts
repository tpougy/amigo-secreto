// Ferramentas do MCP: funções puras sobre um `db` JÁ impersonado (`admin.asUser({ email })`).
// Todas as leituras e escritas passam pelas regras do Instant como o próprio usuário: nada aqui
// usa privilégio de admin, então ninguém enxerga o par de outra pessoa.
// Devolvem rótulos e valores, nunca ids de participantes ou respostas.
import { lookup, type init } from "@instantdb/admin";
import {
  formatarCodigo,
  limparRespostas,
  normalizarCodigo,
  perfilCompleto,
  validarResposta,
  type DefCampo,
  type TipoCampo,
  type ValorResposta,
} from "@amigo/dominio";
import type { AppSchema } from "@amigo/instant";

export type Db = ReturnType<ReturnType<typeof init<AppSchema>>["asUser"]>;

export type GrupoResumo = {
  id: string;
  titulo: string;
  codigo: string; // XXX-XXX
  tema: string;
  status: string;
};

export type Erro = { erro: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resumo(g: { id: string; titulo: string; codigo: string; tema: string; status: string }): GrupoResumo {
  return { id: g.id, titulo: g.titulo, codigo: formatarCodigo(g.codigo), tema: g.tema, status: g.status };
}

function defCampo(c: {
  id: string;
  rotulo: string;
  ajuda?: string | null;
  tipo: string;
  opcoes?: unknown;
  obrigatorio: boolean;
  ordem: number;
}): DefCampo {
  return {
    id: c.id,
    rotulo: c.rotulo,
    ...(c.ajuda ? { ajuda: c.ajuda } : {}),
    tipo: c.tipo as TipoCampo,
    ...(Array.isArray(c.opcoes) ? { opcoes: c.opcoes.map(String) } : {}),
    obrigatorio: c.obrigatorio,
    ordem: c.ordem,
  };
}

/** Id do usuário autenticado (a regra de `$users` só mostra o próprio). */
async function meuId(db: Db): Promise<string | null> {
  const { $users } = await db.query({ $users: {} });
  return $users[0]?.id ?? null;
}

/**
 * Acha o grupo (por id ou código, com ruído de digitação) e a participação ativa do usuário nele.
 * Grupo que o usuário não pode ver (não é membro nem organizador) = "não encontrado".
 */
async function contexto(db: Db, grupo: string) {
  const codigo = normalizarCodigo(grupo);
  const id = grupo.trim();
  if (!codigo && !UUID.test(id)) return { erro: "Grupo não encontrado" } as Erro;
  const eu = await meuId(db);
  if (!eu) return { erro: "Usuário não encontrado" } as Erro;
  const { grupos } = await db.query({
    grupos: {
      $: { where: codigo ? { codigo } : { id } },
      campos: {},
      sorteios: {},
      participantes: { $: { where: { "usuario.id": eu } }, respostas: { campo: {} } },
    },
  });
  const g = grupos[0];
  if (!g) return { erro: "Grupo não encontrado" } as Erro;
  const participante = g.participantes.find((p) => !p.removido);
  if (!participante) return { erro: "Você não participa deste grupo" } as Erro;
  const campos = g.campos.map(defCampo).sort((a, b) => a.ordem - b.ordem);
  return { grupo: g, participante, campos };
}

function respostasPorCampo(respostas: { valor: unknown; campo?: { id: string } | null }[]) {
  const m: Record<string, unknown> = {};
  for (const r of respostas) if (r.campo?.id) m[r.campo.id] = r.valor;
  return m;
}

export async function meusGrupos(db: Db): Promise<{ organizando: GrupoResumo[]; participando: GrupoResumo[] }> {
  const { $users } = await db.query({
    $users: { gruposOrganizados: {}, participacoes: { grupo: {} } },
  });
  const eu = $users[0];
  if (!eu) return { organizando: [], participando: [] };
  return {
    organizando: eu.gruposOrganizados.map(resumo),
    participando: eu.participacoes.flatMap((p) => (!p.removido && p.grupo ? [resumo(p.grupo)] : [])),
  };
}

export const AVISO_SEM_SORTEIO = "O sorteio ainda não aconteceu";
export const AVISO_REFAZENDO = "O sorteio está sendo refeito. Tente de novo em instantes.";

export type AmigoSecreto =
  | { apelido: string; respostas: { rotulo: string; valor: ValorResposta }[] }
  | { aviso: typeof AVISO_SEM_SORTEIO | typeof AVISO_REFAZENDO };

export async function meuAmigoSecreto(db: Db, grupo: string): Promise<AmigoSecreto | Erro> {
  const ctx = await contexto(db, grupo);
  if ("erro" in ctx) return ctx;
  // Sorteio em andamento: o par atual está para mudar. Não devolve nem marca `viuParNaRodada`.
  if (ctx.grupo.sorteios.some((s) => s.status === "pendente" || s.status === "processando")) {
    // Grupo reaberto (`aberto` com rodada >= 1) não tem par a refazer: é um sorteio novo.
    const refazendo = ctx.grupo.status !== "aberto" && ctx.grupo.rodadaAtual >= 1;
    return { aviso: refazendo ? AVISO_REFAZENDO : AVISO_SEM_SORTEIO };
  }
  // A regra de `pares` só mostra o par em que o usuário é o doador.
  const { pares } = await db.query({
    pares: {
      $: { where: { "doador.id": ctx.participante.id } },
      sorteio: {},
      receptor: { respostas: { campo: {} } },
    },
  });
  const par = pares
    .filter((p) => p.sorteio?.status === "concluido" && p.receptor)
    .sort((a, b) => (b.sorteio?.rodada ?? 0) - (a.sorteio?.rodada ?? 0))[0];
  if (!par?.receptor || !par.sorteio) return { aviso: AVISO_SEM_SORTEIO };

  // Ver o par pelo MCP conta como "já viu" (como revelar o par na página).
  const rodada = par.sorteio.rodada;
  if (ctx.participante.viuParNaRodada !== rodada) {
    await db.transact(db.tx.participantes[ctx.participante.id]!.update({ viuParNaRodada: rodada }));
  }

  const limpas = limparRespostas(ctx.campos, respostasPorCampo(par.receptor.respostas));
  return {
    apelido: par.receptor.apelido,
    respostas: ctx.campos.flatMap((c) => (c.id in limpas ? [{ rotulo: c.rotulo, valor: limpas[c.id]! }] : [])),
  };
}

export const ERRO_PERFIS_OCULTOS =
  "Neste grupo o organizador não liberou ver o perfil dos outros participantes. " +
  "Para ver o perfil de quem você tirou, use meu_amigo_secreto.";

export type PerfilParticipante = { apelido: string; respostas: { rotulo: string; valor: ValorResposta }[] };

/**
 * Perfil (respostas) de outro participante, achado pelo apelido. Só quando o organizador ligou
 * `perfisVisiveis`; a regra de `respostas` é quem garante, aqui só se explica a recusa.
 */
export async function perfilParticipante(
  db: Db,
  grupo: string,
  apelido: string,
): Promise<PerfilParticipante | Erro> {
  const ctx = await contexto(db, grupo);
  if ("erro" in ctx) return ctx;
  if (!ctx.grupo.perfisVisiveis) return { erro: ERRO_PERFIS_OCULTOS };
  const { participantes } = await db.query({
    participantes: {
      $: { where: { "grupo.id": ctx.grupo.id, removido: false } },
      respostas: { campo: {} },
    },
  });
  const alvo = normalizarRotulo(apelido);
  const achados = participantes.filter((p) => normalizarRotulo(p.apelido) === alvo);
  if (achados.length !== 1) {
    const nomes = participantes.map((p) => p.apelido).sort((a, b) => a.localeCompare(b, "pt-BR"));
    return {
      erro:
        (achados.length ? "Há mais de um participante com esse apelido" : "Participante não encontrado") +
        `. Participantes: ${nomes.join(", ")}`,
    };
  }
  const p = achados[0]!;
  const limpas = limparRespostas(ctx.campos, respostasPorCampo(p.respostas));
  return {
    apelido: p.apelido,
    respostas: ctx.campos.flatMap((c) => (c.id in limpas ? [{ rotulo: c.rotulo, valor: limpas[c.id]! }] : [])),
  };
}

export type CampoPerfil = {
  rotulo: string;
  tipo: TipoCampo;
  obrigatorio: boolean;
  ajuda?: string;
  opcoes?: string[];
  valor?: ValorResposta;
};

export async function meuPerfil(db: Db, grupo: string): Promise<{ campos: CampoPerfil[] } | Erro> {
  const ctx = await contexto(db, grupo);
  if ("erro" in ctx) return ctx;
  const limpas = limparRespostas(ctx.campos, respostasPorCampo(ctx.participante.respostas));
  return {
    campos: ctx.campos.map((c) => ({
      rotulo: c.rotulo,
      tipo: c.tipo,
      obrigatorio: c.obrigatorio,
      ...(c.ajuda ? { ajuda: c.ajuda } : {}),
      ...(c.opcoes ? { opcoes: c.opcoes } : {}),
      ...(c.id in limpas ? { valor: limpas[c.id] } : {}),
    })),
  };
}

const normalizarRotulo = (s: string) => s.trim().toLocaleLowerCase("pt-BR");

function vazio(v: ValorResposta): boolean {
  return typeof v === "string" ? v === "" : v.length === 0;
}

/**
 * Grava (ou apaga, se vier vazio num campo opcional) a resposta do usuário a um campo, achado pelo
 * rótulo, e recalcula `perfilCompleto`. Mesmo padrão do formulário do app: atualiza a resposta
 * existente pelo id; só cria (upsert por `chave` única) quando ainda não há.
 */
export async function atualizarResposta(
  db: Db,
  grupo: string,
  campoRotulo: string,
  valor: unknown,
): Promise<{ ok: true } | Erro> {
  const ctx = await contexto(db, grupo);
  if ("erro" in ctx) return ctx;
  const campo = ctx.campos.find((c) => normalizarRotulo(c.rotulo) === normalizarRotulo(campoRotulo));
  if (!campo) return { erro: `Campo "${campoRotulo}" não existe neste grupo` };

  const r = validarResposta(campo, valor);
  if (!r.ok) return { erro: r.erro };
  const apagar = vazio(r.valor);
  if (apagar && campo.obrigatorio) return { erro: "Campo obrigatório" };

  const participanteId = ctx.participante.id;
  const existente = ctx.participante.respostas.find((x) => x.campo?.id === campo.id);
  const respostas = respostasPorCampo(ctx.participante.respostas);
  const ops = [];
  if (apagar) {
    delete respostas[campo.id];
    if (existente) ops.push(db.tx.respostas[existente.id]!.delete());
  } else {
    respostas[campo.id] = r.valor;
    ops.push(
      existente
        ? db.tx.respostas[existente.id]!.update({ valor: r.valor })
        : db.tx.respostas[lookup("chave", `${participanteId}:${campo.id}`)]!
            .update({ valor: r.valor })
            .link({ participante: participanteId, campo: campo.id }),
    );
  }
  ops.push(
    db.tx.participantes[participanteId]!.update({ perfilCompleto: perfilCompleto(ctx.campos, respostas) }),
  );
  await db.transact(ops);
  return { ok: true };
}
