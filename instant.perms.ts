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
      },
      unlink: {
        organizador: "false",
        participantes: "true",
        campos: "true",
        restricoes: "true",
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
        "request.modifiedFields.all(f, f in ['apelido', 'perfilCompleto', 'viuParNaRodada', 'removido']) && removidoSoTrue",
      soCamposDoOrganizador:
        "request.modifiedFields.all(f, f in ['removido']) && removidoSoTrue",
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
      },
      unlink: {
        grupo: "false",
        usuario: "ehProprio || ehOrganizador",
        respostas: "false",
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
      participantesDoGrupo:
        "size(data.ref('grupo.id')) == 1 && data.ref('grupo.id')[0] in data.ref('participanteA.grupo.id') && data.ref('grupo.id')[0] in data.ref('participanteB.grupo.id')",
    },
    allow: {
      view: "ehOrganizador",
      create: "ehOrganizador && participantesDoGrupo",
      update: "ehOrganizador",
      delete: "ehOrganizador",
      // Links só na criação; para mudar, apaga-se a restrição e cria-se outra.
      link: {
        grupo: "actions.data == 'create' && auth.id in linkedData.ref('organizador.id')",
        participanteA: "actions.data == 'create'",
        participanteB: "actions.data == 'create'",
      },
      unlink: { grupo: "false", participanteA: "false", participanteB: "false" },
    },
  },

  // Regras de sorteios/pares/conta chegam na Task 6; até lá, nada para clientes.
  sorteios: { allow: { view: "false", create: "false", update: "false", delete: "false" } },
  pares: { allow: { view: "false", create: "false", update: "false", delete: "false" } },
} satisfies InstantRules<AppSchema>;

export default rules;
