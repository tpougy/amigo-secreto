// Regras de permissão do Instant (instantdb-rust, ver docs/PARITY.md).
// Aplicadas com `infra/instant-push.sh <prod|teste>`; testadas em testes/permissoes.*.test.ts.
//
// "Membro" de um grupo = usuário ligado a um participante do grupo (ou o organizador).
// Não-membros só enxergam um grupo (e os campos dele) informando o código certo via
// `ruleParams.codigo`, o que impede enumerar grupos.
import type { InstantRules } from "@instantdb/core";
import type { AppSchema } from "./instant.schema";

const rules = {
  $rateLimits: {
    // Entradas em grupos: 20 tentativas, recarga de 20 por hora (cobra também as negadas).
    entrada: {
      limits: [{ capacity: 20, refill: { amount: 20, period: "1 hour", type: "greedy" } }],
    },
    // Pedidos de sorteio: 5 por hora por usuário (cobra também os negados).
    sorteio: {
      limits: [{ capacity: 5, refill: { amount: 5, period: "1 hour", type: "greedy" } }],
    },
  },

  // Cliente não cria atributos novos (schemaless); só o admin/CLI mexe no schema.
  attrs: {
    allow: { create: "false" },
  },

  grupos: {
    bind: {
      ehOrganizador: "auth.id != null && auth.id in data.ref('organizador.id')",
      ehMembro: "auth.id != null && auth.id in data.ref('participantes.usuario.id')",
      temCodigo: "ruleParams.codigo != null && ruleParams.codigo == data.codigo",
      camposProtegidos:
        "'rodadaAtual' in request.modifiedFields || 'codigo' in request.modifiedFields",
      statusPermitido: "!('status' in request.modifiedFields) || newData.status == 'encerrado'",
      criadoAberto: "data.status == 'aberto' && data.rodadaAtual == 0",
    },
    allow: {
      view: "ehOrganizador || ehMembro || temCodigo",
      create: "ehOrganizador && criadoAberto",
      update: "ehOrganizador && !camposProtegidos && statusPermitido",
      delete: "ehOrganizador",
      // Os lados "filhos" (campos, participantes, restrições) têm as próprias regras de link;
      // aqui só se protege a troca de organizador.
      link: {
        organizador: "actions.data == 'create' && auth.id == linkedData.id",
        participantes: "true",
        campos: "true",
        restricoes: "true",
        sorteios: "true",
        // Capa: só o organizador liga/desliga; o lado do arquivo confere o path (ver $files).
        capa: "ehOrganizador",
      },
      unlink: {
        organizador: "false",
        participantes: "true",
        campos: "true",
        restricoes: "true",
        sorteios: "true",
        capa: "ehOrganizador",
      },
    },
  },

  campos: {
    bind: {
      ehOrganizador: "auth.id != null && auth.id in data.ref('grupo.organizador.id')",
      ehMembro: "auth.id != null && auth.id in data.ref('grupo.participantes.usuario.id')",
      temCodigo: "ruleParams.codigo != null && ruleParams.codigo in data.ref('grupo.codigo')",
    },
    allow: {
      view: "ehOrganizador || ehMembro || temCodigo",
      create: "ehOrganizador",
      update: "ehOrganizador",
      delete: "ehOrganizador",
      link: {
        grupo: "actions.data == 'create' && auth.id in linkedData.ref('organizador.id')",
      },
      unlink: { grupo: "false" },
    },
  },

  participantes: {
    bind: {
      ehProprio: "auth.id != null && auth.id in data.ref('usuario.id')",
      ehOrganizador: "auth.id != null && auth.id in data.ref('grupo.organizador.id')",
      ehMembro: "auth.id != null && auth.id in data.ref('grupo.participantes.usuario.id')",
      codigoCerto:
        "ruleParams.codigo != null && ruleParams.codigo in data.ref('grupo.codigo')",
      grupoAberto: "'aberto' in data.ref('grupo.status')",
      chaveCerta:
        "size(data.ref('grupo.id')) == 1 && data.chave == data.ref('grupo.id')[0] + ':' + auth.id",
      // `removido` só vai de false para true (remoção é definitiva, nos dois caminhos).
      removidoSoTrue: "!('removido' in request.modifiedFields) || newData.removido == true",
      soCamposDoProprio:
        "request.modifiedFields.all(f, f in ['apelido', 'perfilCompleto', 'viuParNaRodada', 'removido', 'removidoNaRodada']) && removidoSoTrue",
      soCamposDoOrganizador:
        "request.modifiedFields.all(f, f in ['removido', 'removidoNaRodada']) && removidoSoTrue",
    },
    allow: {
      view: "ehMembro || ehOrganizador",
      // rateLimit primeiro: toda tentativa (inclusive negada) gasta um token.
      create:
        "rateLimit.entrada.limit(auth.id) && ehProprio && chaveCerta && grupoAberto && (codigoCerto || ehOrganizador)",
      update: "(ehProprio && soCamposDoProprio) || (ehOrganizador && soCamposDoOrganizador)",
      delete: "ehOrganizador || (ehProprio && grupoAberto)",
      link: {
        grupo: "actions.data == 'create'",
        usuario: "actions.data == 'create' && auth.id == linkedData.id",
        // Pares só são gravados pelo worker (admin).
        doando: "false",
        recebidoDe: "false",
      },
      unlink: {
        grupo: "false",
        usuario: "ehProprio || ehOrganizador",
        respostas: "false",
        doando: "false",
        recebidoDe: "false",
      },
    },
  },

  respostas: {
    bind: {
      ehDono: "auth.id != null && auth.id in data.ref('participante.usuario.id')",
      ehOrganizador: "auth.id != null && auth.id in data.ref('participante.grupo.organizador.id')",
      tirouODono:
        "auth.id != null && auth.id in data.ref('participante.recebidoDe.doador.usuario.id')",
      chaveCerta:
        "size(data.ref('participante.id')) == 1 && size(data.ref('campo.id')) == 1 && data.chave == data.ref('participante.id')[0] + ':' + data.ref('campo.id')[0]",
      campoDoMesmoGrupo:
        "size(data.ref('campo.grupo.id')) == 1 && data.ref('campo.grupo.id')[0] in data.ref('participante.grupo.id')",
    },
    allow: {
      view: "ehDono || tirouODono",
      create: "ehDono && chaveCerta && campoDoMesmoGrupo",
      update: "ehDono && request.modifiedFields.all(f, f == 'valor')",
      delete: "ehDono || ehOrganizador",
      link: {
        participante: "actions.data == 'create'",
        campo: "actions.data == 'create'",
      },
      unlink: { participante: "false", campo: "false" },
    },
  },

  restricoes: {
    bind: {
      ehOrganizador: "auth.id != null && auth.id in data.ref('grupo.organizador.id')",
      // Quem sai do grupo (delete do próprio participante) apaga em cascata as restrições que o citam.
      citaOAutorComGrupoAberto:
        "auth.id != null && 'aberto' in data.ref('grupo.status') && (auth.id in data.ref('participanteA.usuario.id') || auth.id in data.ref('participanteB.usuario.id'))",
      participantesDoGrupo:
        "size(data.ref('grupo.id')) == 1 && data.ref('grupo.id')[0] in data.ref('participanteA.grupo.id') && data.ref('grupo.id')[0] in data.ref('participanteB.grupo.id')",
    },
    allow: {
      view: "ehOrganizador",
      create: "ehOrganizador && participantesDoGrupo",
      update: "ehOrganizador",
      // O servidor checa `delete` nos filhos da cascata: sem este termo, sair do grupo (só com o
      // grupo aberto) falharia para quem aparece numa restrição. Quem é citado não vê a
      // restrição (view: só o organizador; o id não vaza pelos links), então na prática só a
      // apaga junto com a própria participação.
      delete: "ehOrganizador || citaOAutorComGrupoAberto",
      // Links só na criação; para mudar, apaga-se a restrição e cria-se outra.
      link: {
        grupo: "actions.data == 'create' && auth.id in linkedData.ref('organizador.id')",
        participanteA: "actions.data == 'create'",
        participanteB: "actions.data == 'create'",
      },
      unlink: { grupo: "false", participanteA: "false", participanteB: "false" },
    },
  },

  sorteios: {
    bind: {
      ehOrganizador: "auth.id != null && auth.id in data.ref('grupo.organizador.id')",
      ehMembro: "auth.id != null && auth.id in data.ref('grupo.participantes.usuario.id')",
      // Rodada seguinte à atual, no máximo 3; a chave <grupoId>:<rodada> garante um pedido por rodada.
      rodadaValida:
        "data.rodada <= 3 && (data.rodada - 1) in data.ref('grupo.rodadaAtual')",
      chaveCerta:
        "size(data.ref('grupo.id')) == 1 && data.chave == data.ref('grupo.id')[0] + ':' + string(int(data.rodada))",
      grupoNaoEncerrado: "!('encerrado' in data.ref('grupo.status'))",
    },
    allow: {
      view: "ehMembro || ehOrganizador",
      // rateLimit primeiro: todo pedido (inclusive negado) gasta um token.
      create:
        "rateLimit.sorteio.limit(auth.id) && ehOrganizador && data.status == 'pendente' && rodadaValida && chaveCerta && grupoNaoEncerrado",
      // Status, erro, conclusão e pares: só o worker (admin).
      update: "false",
      // O servidor checa `delete` também nos filhos apagados em cascata: sem isso o
      // organizador não consegue apagar o grupo depois do sorteio. Não lhe dá poder novo
      // (ele já pode apagar o grupo inteiro) nem revela pares.
      delete: "ehOrganizador",
      link: {
        grupo: "actions.data == 'create' && auth.id in linkedData.ref('organizador.id')",
        pares: "false",
      },
      unlink: { grupo: "false", pares: "false" },
    },
  },

  // Cada um vê só o próprio par (em que é o doador). Escrita só pelo worker (admin).
  pares: {
    allow: {
      view: "auth.id != null && auth.id in data.ref('doador.usuario.id')",
      create: "false",
      update: "false",
      // Só para a cascata de "organizador apaga o grupo" (ver sorteios.delete).
      delete: "auth.id != null && auth.id in data.ref('sorteio.grupo.organizador.id')",
      link: { sorteio: "false", doador: "false", receptor: "false" },
      unlink: { sorteio: "false", doador: "false", receptor: "false" },
    },
  },

  // Capa do grupo: `grupos/<grupoId>/capa.jpg`. O id do grupo vem do path, conferido contra os
  // grupos que o usuário organiza (`auth.ref`), porque no upload o arquivo ainda não tem link.
  $files: {
    bind: {
      organizaPeloPath:
        "auth.id != null && auth.ref('$user.gruposOrganizados.id').exists(g, data.path.startsWith('grupos/' + g + '/'))",
      capaDoGrupoLigado:
        "size(data.ref('grupoCapa.id')) == 1 && data.path.startsWith('grupos/' + data.ref('grupoCapa.id')[0] + '/')",
      membroDoGrupoLigado:
        "auth.id != null && (auth.id in data.ref('grupoCapa.participantes.usuario.id') || auth.id in data.ref('grupoCapa.organizador.id'))",
    },
    allow: {
      view: "organizaPeloPath || (capaDoGrupoLigado && membroDoGrupoLigado)",
      create: "organizaPeloPath",
      update: "organizaPeloPath",
      delete: "organizaPeloPath",
    },
  },

  // Pedido de exclusão de conta: o próprio usuário cria (ligado ao próprio $users) e vê; o
  // worker (admin) executa e marca `concluido`. Imutável para o cliente.
  pedidosExclusao: {
    allow: {
      view: "auth.id != null && auth.id in data.ref('usuario.id')",
      create: "auth.id != null && auth.id in data.ref('usuario.id') && data.status == 'pendente'",
      update: "false",
      delete: "false",
      link: { usuario: "actions.data == 'create' && auth.id == linkedData.id" },
      unlink: { usuario: "false" },
    },
  },

  // Conta: o usuário vê só a própria. O servidor recusa regra de `delete` em `$users`
  // ("doesn't support permissions for delete"): apagar a conta exige o admin
  // (`auth.deleteUser`), ver discussion/ideias.md §10.
  $users: {
    allow: {
      view: "auth.id == data.id",
      delete: "false",
    },
  },
} satisfies InstantRules<AppSchema>;

// `$streams` é entidade de sistema fora do schema do app, então fica fora do `satisfies`.
const regrasStreams = {
  // Progresso do sorteio (`sorteio-<sorteioId>`): só o worker (admin) escreve; lê quem é membro
  // ou organizador do grupo do sorteio.
  $streams: {
    bind: {
      sorteioDoStream: "data.clientId.startsWith('sorteio-') ? data.clientId.substring(8) : ''",
    },
    allow: {
      view:
        "auth.id != null && (sorteioDoStream in auth.ref('$user.participacoes.grupo.sorteios.id') || sorteioDoStream in auth.ref('$user.gruposOrganizados.sorteios.id'))",
      create: "false",
      update: "false",
      delete: "false",
    },
  },
};

export default { ...rules, ...regrasStreams };
