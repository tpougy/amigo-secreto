// Os três pedidos do amigo-secreto, declarados com `instant-commands`: deles saem as entidades e
// links do schema (`commandEntities`/`commandLinks` em schema.ts) e as regras (`mergePerms` em
// perms.ts). Compartilhado por app, worker e testes: importável no navegador, então importa só
// `instant-commands` (nunca `instant-commands/worker`).
import { i } from "@instantdb/core";
import { z } from "zod";
import * as ic from "instant-commands";

/**
 * Texto CEL "há pedido aberto (`pending` ou `running`) em `caminho`" (um `data.ref` de status).
 * As regras cruzadas usam a negação: `!emAberto('grupo.sorteios.status')`. Reexportado por perms.ts.
 * Mora aqui (e não em perms.ts) porque perms.ts importa este módulo.
 */
export function emAberto(caminho: string): string {
  return `('pending' in data.ref('${caminho}') || 'running' in data.ref('${caminho}'))`;
}

// Pedidos de sorteio e de reabertura: 5 por hora por usuário (cobra também os negados).
const CINCO_POR_HORA = {
  limits: [{ capacity: 5, refill: { amount: 5, period: "1 hour", type: "greedy" as const } }],
};

export const sorteio = ic.defineCommand({
  name: "sorteio",
  entity: "sorteios",
  fields: {
    rodada: i.number(),
    chave: i.string().unique(), // <grupoId>:<rodada>
  },
  links: {
    sorteioGrupo: {
      forward: { on: "sorteios", has: "one", label: "grupo", onDelete: "cascade" },
      reverse: { on: "grupos", has: "many", label: "sorteios" },
    },
  },
  bind: {
    ehOrganizador: "auth.id != null && auth.id in data.ref('grupo.organizador.id')",
    ehMembro: "auth.id != null && auth.id in data.ref('grupo.participantes.usuario.id')",
    // Rodada seguinte à atual, no máximo 3 por abertura (rodada − rodadaBase ≤ 3, com
    // rodadaBase ausente = 0: grupos antigos não têm o atributo e o ref volta vazio ou [null]).
    // Como rodadaBase ≥ 0, `rodada <= 3` já basta quando cabe. A chave <grupoId>:<rodada>
    // garante um pedido por rodada.
    rodadaValida:
      "(data.rodada <= 3 || data.ref('grupo.rodadaBase').exists(b, b != null && data.rodada - b <= 3)) && (data.rodada - 1) in data.ref('grupo.rodadaAtual')",
    chaveCerta:
      "size(data.ref('grupo.id')) == 1 && data.chave == data.ref('grupo.id')[0] + ':' + string(int(data.rodada))",
    grupoNaoEncerrado: "!('encerrado' in data.ref('grupo.status'))",
    // Com uma reabertura aberta, o sorteio espera: senão a reabertura apagaria os pares novos.
    semReaberturaAberta: `!${emAberto("grupo.reaberturas.status")}`,
  },
  allow: {
    // A biblioteca acrescenta o rateLimit (primeiro: todo pedido, inclusive negado, gasta um
    // token) e os campos padrão (`status == 'pending'` etc.).
    create: "ehOrganizador && rodadaValida && chaveCerta && grupoNaoEncerrado && semReaberturaAberta",
    view: "ehMembro || ehOrganizador",
    // O servidor checa `delete` também nos filhos apagados em cascata: sem isso o organizador
    // não consegue apagar o grupo depois do sorteio. Não lhe dá poder novo (ele já pode apagar o
    // grupo inteiro) nem revela pares.
    delete: "ehOrganizador",
    // Os pares (link `parSorteio`) ficam protegidos pelo lado `pares` (perms.ts) e pelo
    // `update: "false"` gerado; testado em permissoes.commands.test.ts.
    link: { grupo: "auth.id in linkedData.ref('organizador.id')" },
  },
  rateLimit: CINCO_POR_HORA,
  result: z.object({ pares: z.number().int() }),
});

// Reabrir o grupo (desfazer o sorteio): só o organizador cria, com o grupo `sorteado` e sem
// sorteio aberto; o worker apaga os pares, reabre o grupo e grava `rodadaBase`.
export const reabertura = ic.defineCommand({
  name: "reabertura",
  entity: "reaberturas",
  links: {
    reaberturaGrupo: {
      forward: { on: "reaberturas", has: "one", label: "grupo", onDelete: "cascade" },
      reverse: { on: "grupos", has: "many", label: "reaberturas" },
    },
  },
  bind: {
    ehOrganizador: "auth.id != null && auth.id in data.ref('grupo.organizador.id')",
    ehMembro: "auth.id != null && auth.id in data.ref('grupo.participantes.usuario.id')",
    grupoSorteado: "'sorteado' in data.ref('grupo.status')",
    semSorteioAberto: `!${emAberto("grupo.sorteios.status")}`,
  },
  allow: {
    create: "ehOrganizador && grupoSorteado && semSorteioAberto",
    view: "ehMembro || ehOrganizador",
    // Como em sorteio: o servidor checa `delete` também nos filhos apagados em cascata (avaliado
    // no estado anterior, com o grupo ainda ligado), então sem isso o organizador não apaga o
    // grupo depois de reabrir. Não lhe dá poder novo: ele já pode apagar o grupo inteiro.
    delete: "ehOrganizador",
    link: { grupo: "auth.id in linkedData.ref('organizador.id')" },
  },
  rateLimit: CINCO_POR_HORA,
  result: z.object({ pares: z.number().int() }),
});

// "Apagar minha conta": o próprio usuário cria (ligado ao próprio $users) e vê; o worker executa.
// Sem cascata: o pedido sobrevive ao usuário, como histórico.
export const exclusaoConta = ic.defineCommand({
  name: "exclusao-conta",
  entity: "pedidosExclusao",
  links: {
    pedidoExclusaoUsuario: {
      forward: { on: "pedidosExclusao", has: "one", label: "usuario" },
      reverse: { on: "$users", has: "many", label: "pedidosExclusao" },
    },
  },
  allow: {
    create: "auth.id != null && auth.id in data.ref('usuario.id')",
    view: "auth.id != null && auth.id in data.ref('usuario.id')",
    delete: "false",
    link: { usuario: "auth.id == linkedData.id" },
  },
  result: z.object({
    anonimizadas: z.number().int(),
    semRefazer: z.number().int(),
    apagadas: z.number().int(),
    grupos: z.number().int(),
  }),
});

export const commands = [sorteio, reabertura, exclusaoConta] as const;
