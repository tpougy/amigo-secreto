// Servidor MCP do amigo secreto (Dokku `amigo-mcp`, https://amigo-mcp.app.tpou.gy).
// Login com Google (OAuth proxy do fastmcp); cada ferramenta age COMO o usuário logado via
// `admin.asUser({ email })`, então as regras do Instant valem como no app.
// Logs: só nome da ferramenta, resultado e duração. Nunca e-mails, nomes, pares ou respostas.
import { FastMCP, UserError } from "fastmcp";
import { DiskStore } from "fastmcp/auth";
import { init } from "@instantdb/admin";
import { z } from "zod";
import schema from "@amigo/instant";
import { GoogleComEmail } from "./google";
import {
  atualizarResposta,
  editarCamposPerfil,
  editarGrupo,
  meuAmigoSecreto,
  meuPerfil,
  meusGrupos,
  painelGrupo,
  perfilParticipante,
  type Db,
} from "./ferramentas";
import { TIPOS_CAMPO } from "@amigo/dominio";

function exigir(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`variável ${nome} ausente`);
  return v;
}

const BASE_URL = process.env.MCP_BASE_URL ?? "https://amigo-mcp.app.tpou.gy";
const PORTA = Number(process.env.PORT ?? 8080);
const PENDENTE = "pendente";
const clientId = process.env.GOOGLE_CLIENT_ID ?? PENDENTE;
const googleConfigurado = clientId !== PENDENTE && clientId !== "";

function log(evento: string, dados: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ evento, ...dados }));
}

const admin = init({
  appId: exigir("INSTANT_APP_ID"),
  adminToken: exigir("INSTANT_ADMIN_TOKEN"),
  apiURI: process.env.INSTANT_API_URI ?? "https://instant.tpou.gy",
  schema,
});

const auth = new GoogleComEmail({
  baseUrl: BASE_URL,
  clientId,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? PENDENTE,
  scopes: ["openid", "email", "profile"],
  allowedRedirectUriPatterns: [
    "https://claude.ai/*",
    "https://claude.com/*",
    "https://chatgpt.com/*",
    "http://localhost:*",
  ],
  tokenStorage: new DiskStore({ directory: process.env.MCP_TOKENS_DIR ?? "/data/tokens" }),
  encryptionKey: exigir("MCP_ENCRYPTION_KEY"),
  jwtSigningKey: exigir("MCP_JWT_KEY"),
});

// Logger do fastmcp sem `debug` (que pode despejar requisições inteiras).
const logger = {
  debug: () => {},
  error: (...a: unknown[]) => console.error(...a),
  info: (...a: unknown[]) => console.log(...a),
  log: (...a: unknown[]) => console.log(...a),
  warn: (...a: unknown[]) => console.warn(...a),
};

const servidor = new FastMCP({
  name: "Amigo secreto",
  version: "1.0.0",
  auth,
  logger,
  health: { message: "ok" },
  instructions:
    "Ferramentas do amigo secreto do usuário logado: os grupos dele, quem ele tirou no sorteio (com o perfil " +
    "de gostos dessa pessoa) e o próprio perfil. O parâmetro `grupo` aceita o id ou o código do grupo " +
    "(XXX-XXX). Nunca é possível ver o par de outra pessoa.",
});

if (!googleConfigurado) {
  // Rotas próprias (Hono) rodam antes das do OAuth: sem credenciais, o login falha com recado claro
  // em vez de levar a pessoa a um erro `invalid_client` do Google.
  const recado =
    "O login com Google deste servidor MCP ainda não foi configurado (GOOGLE_CLIENT_ID pendente). " +
    "Tente de novo depois que o administrador configurar as credenciais.";
  for (const rota of ["/oauth/authorize", "/oauth/callback"]) {
    servidor.getApp().get(rota, (c) => c.text(recado, 503));
  }
}

type Sessao = { email?: string } | undefined;

/** Executa a ferramenta como o dono da sessão; erros de domínio viram `UserError`. */
async function comoUsuario<T>(nome: string, sessao: Sessao, fn: (db: Db) => Promise<T>): Promise<string> {
  const t0 = Date.now();
  if (!sessao?.email) {
    log("mcp.ferramenta", { nome, ok: false, motivo: "sem-email" });
    throw new UserError("Não autenticado: faça login com o Google para usar esta ferramenta.");
  }
  let r: T;
  try {
    r = await fn(admin.asUser({ email: sessao.email }));
  } catch (e) {
    const tipo = (e as { body?: { type?: string } })?.body?.type ?? (e as Error)?.name ?? "erro";
    log("mcp.ferramenta", { nome, ok: false, motivo: tipo, ms: Date.now() - t0 });
    throw new UserError("Não foi possível falar com o banco do amigo secreto. Tente de novo.");
  }
  const erro = r && typeof r === "object" && "erro" in r ? String((r as { erro: unknown }).erro) : null;
  log("mcp.ferramenta", { nome, ok: !erro, ms: Date.now() - t0 });
  if (erro) throw new UserError(erro);
  return JSON.stringify(r);
}

const grupo = z
  .string()
  .min(1)
  .describe("Id do grupo ou código de 6 caracteres (ex.: KQ7-M4P; maiúsculas, hífen e espaços são ignorados)");

servidor.addTool({
  name: "meus_grupos",
  description:
    "Lista os grupos de amigo secreto do usuário. Retorna { organizando, participando }, cada um uma lista de " +
    "{ id, titulo, codigo (XXX-XXX), tema, status (aberto | sorteado | encerrado) }.",
  parameters: z.object({}),
  annotations: { readOnlyHint: true },
  execute: (_a, ctx) => comoUsuario("meus_grupos", ctx.session, (db) => meusGrupos(db)),
});

servidor.addTool({
  name: "meu_amigo_secreto",
  description:
    "Mostra quem o usuário tirou no sorteio do grupo. Retorna { apelido, respostas: [{ rotulo, valor }] } com " +
    "o perfil de gostos dessa pessoa (use para sugerir presentes), ou { aviso } se o sorteio ainda não aconteceu. " +
    "Conta como o usuário ter visto o próprio par. Só existe o próprio par: não há como ver o de outra pessoa (o perfil de outros, quando liberado, vem de perfil_participante).",
  parameters: z.object({ grupo }),
  annotations: { readOnlyHint: false, idempotentHint: true },
  execute: (a, ctx) => comoUsuario("meu_amigo_secreto", ctx.session, (db) => meuAmigoSecreto(db, a.grupo)),
});

servidor.addTool({
  name: "meu_perfil",
  description:
    "Mostra o perfil do usuário no grupo. Retorna { campos: [{ rotulo, tipo, obrigatorio, ajuda?, opcoes?, valor? }] }; " +
    "tipo é texto-curto | texto-longo | lista | multipla | unica, e `valor` falta nos campos sem resposta.",
  parameters: z.object({ grupo }),
  annotations: { readOnlyHint: true },
  execute: (a, ctx) => comoUsuario("meu_perfil", ctx.session, (db) => meuPerfil(db, a.grupo)),
});

servidor.addTool({
  name: "perfil_participante",
  description:
    "Mostra o perfil (respostas) de outro participante do grupo, pelo apelido. Só funciona se o organizador " +
    "liberou ver os perfis no grupo; senão devolve um erro explicando. Retorna { apelido, respostas: [{ rotulo, valor }] }. " +
    "Com apelido desconhecido, o erro lista os apelidos dos participantes. Não revela quem tirou quem.",
  parameters: z.object({
    grupo,
    apelido: z.string().min(1).describe("Apelido do participante, como aparece no grupo"),
  }),
  annotations: { readOnlyHint: true },
  execute: (a, ctx) =>
    comoUsuario("perfil_participante", ctx.session, (db) => perfilParticipante(db, a.grupo, a.apelido)),
});

servidor.addTool({
  name: "atualizar_resposta",
  description:
    "Grava a resposta do usuário a um campo do próprio perfil no grupo (o campo é achado pelo rótulo, como em " +
    "meu_perfil). `valor`: texto para texto-curto, texto-longo e unica (uma das opções); lista de textos para " +
    "lista e multipla (só opções existentes). Vazio apaga a resposta de um campo opcional. Retorna { ok: true } " +
    "ou um erro explicando o motivo (ex.: 'Opção inválida').",
  parameters: z.object({
    grupo,
    campo: z.string().min(1).describe("Rótulo do campo, como aparece em meu_perfil"),
    valor: z.union([z.string(), z.array(z.string())]).describe("Novo valor"),
  }),
  annotations: { readOnlyHint: false, idempotentHint: true },
  execute: (a, ctx) =>
    comoUsuario("atualizar_resposta", ctx.session, (db) => atualizarResposta(db, a.grupo, a.campo, a.valor)),
});

// ---------- Organizador (baixo risco) ----------
const dia = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use AAAA-MM-DD")
  .nullable()
  .optional();

servidor.addTool({
  name: "painel_grupo",
  description:
    "Só para o ORGANIZADOR do grupo: visão geral para administrar. Retorna { titulo, descricao, codigo, tema, status, " +
    "rodada, dataSorteioPrevista, dataEvento (AAAA-MM-DD ou null), valorSugerido, perfisVisiveis, sorteioEmAndamento, " +
    "participantes: [{ apelido, perfilCompleto, removido }], campos: [{ rotulo, tipo, obrigatorio, ajuda?, opcoes? }] }. " +
    "Use para ver quem falta completar o perfil ou antes de editar o grupo ou os campos. Não mostra pares nem respostas.",
  parameters: z.object({ grupo }),
  annotations: { readOnlyHint: true },
  execute: (a, ctx) => comoUsuario("painel_grupo", ctx.session, (db) => painelGrupo(db, a.grupo)),
});

servidor.addTool({
  name: "editar_grupo",
  description:
    "Só para o ORGANIZADOR: muda os dados do grupo. Envie apenas o que mudar. titulo (3 a 80 caracteres), descricao " +
    "(até 500; null apaga), dataSorteioPrevista e dataEvento (AAAA-MM-DD ou null; o evento não pode ser antes do " +
    "sorteio), valorSugerido (>= 0 ou null), perfisVisiveis (true deixa os participantes verem o perfil uns dos " +
    "outros). Retorna { ok: true } ou um erro explicando. Não sorteia, não encerra e não apaga o grupo.",
  parameters: z.object({
    grupo,
    titulo: z.string().optional(),
    descricao: z.string().nullable().optional(),
    dataSorteioPrevista: dia,
    dataEvento: dia,
    valorSugerido: z.number().nullable().optional(),
    perfisVisiveis: z.boolean().optional(),
  }),
  annotations: { readOnlyHint: false, idempotentHint: true },
  execute: ({ grupo: g, ...mudancas }, ctx) =>
    comoUsuario("editar_grupo", ctx.session, (db) => editarGrupo(db, g, mudancas)),
});

servidor.addTool({
  name: "editar_campos_perfil",
  description:
    "Só para o ORGANIZADOR: define os campos do perfil que cada participante preenche (o que quem o tirar vai ver). " +
    "Envie a lista FINAL, na ordem desejada; veja os campos atuais com painel_grupo. Cada campo: rotulo, tipo " +
    "(texto-curto | texto-longo | lista | multipla | unica), obrigatorio, ajuda? (dica curta), opcoes? (multipla e " +
    "unica: ao menos 2), rotuloAtual? (para RENOMEAR um campo existente sem perder as respostas). Campos existentes " +
    "são reconhecidos pelo rótulo (ou rotuloAtual); os novos são criados. Campos atuais que ficarem de fora são " +
    "REMOVIDOS e as respostas dadas a eles se perdem: sem confirmarRemocao: true nada muda e o erro lista o que seria " +
    "removido. Só confirme depois que o usuário concordar. Retorna { ok: true, campos, removidos }.",
  parameters: z.object({
    grupo,
    campos: z.array(
      z.object({
        rotulo: z.string().min(1),
        tipo: z.enum(TIPOS_CAMPO),
        obrigatorio: z.boolean(),
        ajuda: z.string().optional(),
        opcoes: z.array(z.string()).optional(),
        rotuloAtual: z.string().optional(),
      }),
    ),
    confirmarRemocao: z.boolean().optional(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: true },
  execute: (a, ctx) =>
    comoUsuario("editar_campos_perfil", ctx.session, (db) =>
      editarCamposPerfil(db, a.grupo, a.campos, a.confirmarRemocao ?? false),
    ),
});

await servidor.start({ transportType: "httpStream", httpStream: { port: PORTA, host: "0.0.0.0" } });
log("mcp.iniciado", { porta: PORTA, google: googleConfigurado ? "configurado" : PENDENTE });

for (const sinal of ["SIGTERM", "SIGINT"] as const) {
  process.on(sinal, async () => {
    log("mcp.parando", { sinal });
    await servidor.stop();
    process.exit(0);
  });
}
