// Schema do Instant (apps `amigo-secreto` e `amigo-secreto-teste`).
// Aplicado com `infra/instant-push.sh <prod|teste>`.
import { i } from "@instantdb/core";

const _schema = i.schema({
  entities: {
    $files: i.entity({
      path: i.string().unique().indexed(),
      url: i.string(),
    }),
    $users: i.entity({
      email: i.string().unique().indexed().optional(),
    }),
    grupos: i.entity({
      titulo: i.string(),
      descricao: i.string().optional(),
      tema: i.string().indexed(),
      codigo: i.string().unique().indexed(),
      dataSorteioPrevista: i.date().optional(),
      dataEvento: i.date().optional(),
      valorSugerido: i.number().optional(),
      status: i.string().indexed(), // aberto | sorteado | encerrado
      rodadaAtual: i.number(), // começa em 0
      criadoEm: i.date(),
    }),
    campos: i.entity({
      rotulo: i.string(),
      ajuda: i.string().optional(),
      tipo: i.string(),
      opcoes: i.json().optional(),
      obrigatorio: i.boolean(),
      ordem: i.number(),
    }),
    participantes: i.entity({
      apelido: i.string(),
      perfilCompleto: i.boolean(),
      removido: i.boolean(),
      viuParNaRodada: i.number().optional(),
      entrouEm: i.date(),
      chave: i.string().unique(), // <grupoId>:<userId>
    }),
    respostas: i.entity({
      valor: i.json(),
      chave: i.string().unique(), // <participanteId>:<campoId>
    }),
    restricoes: i.entity({
      motivo: i.string().optional(),
    }),
    sorteios: i.entity({
      status: i.string().indexed(), // pendente | processando | concluido | erro
      erro: i.string().optional(),
      rodada: i.number(),
      chave: i.string().unique(), // <grupoId>:<rodada>
      criadoEm: i.date(),
      concluidoEm: i.date().optional(),
    }),
    pares: i.entity({
      chave: i.string().unique(), // <sorteioId>:<doadorParticipanteId>
    }),
  },
  links: {
    grupoOrganizador: {
      forward: { on: "grupos", has: "one", label: "organizador" },
      reverse: { on: "$users", has: "many", label: "gruposOrganizados" },
    },
    campoGrupo: {
      forward: { on: "campos", has: "one", label: "grupo", onDelete: "cascade" },
      reverse: { on: "grupos", has: "many", label: "campos" },
    },
    participanteGrupo: {
      forward: { on: "participantes", has: "one", label: "grupo", onDelete: "cascade" },
      reverse: { on: "grupos", has: "many", label: "participantes" },
    },
    participanteUsuario: {
      forward: { on: "participantes", has: "one", label: "usuario" },
      reverse: { on: "$users", has: "many", label: "participacoes" },
    },
    respostaParticipante: {
      forward: { on: "respostas", has: "one", label: "participante", onDelete: "cascade" },
      reverse: { on: "participantes", has: "many", label: "respostas" },
    },
    respostaCampo: {
      forward: { on: "respostas", has: "one", label: "campo", onDelete: "cascade" },
      reverse: { on: "campos", has: "many", label: "respostas" },
    },
    restricaoGrupo: {
      forward: { on: "restricoes", has: "one", label: "grupo", onDelete: "cascade" },
      reverse: { on: "grupos", has: "many", label: "restricoes" },
    },
    restricaoParticipanteA: {
      forward: { on: "restricoes", has: "one", label: "participanteA", onDelete: "cascade" },
      reverse: { on: "participantes", has: "many", label: "restricoesA" },
    },
    restricaoParticipanteB: {
      forward: { on: "restricoes", has: "one", label: "participanteB", onDelete: "cascade" },
      reverse: { on: "participantes", has: "many", label: "restricoesB" },
    },
    sorteioGrupo: {
      forward: { on: "sorteios", has: "one", label: "grupo", onDelete: "cascade" },
      reverse: { on: "grupos", has: "many", label: "sorteios" },
    },
    parSorteio: {
      forward: { on: "pares", has: "one", label: "sorteio", onDelete: "cascade" },
      reverse: { on: "sorteios", has: "many", label: "pares" },
    },
    parDoador: {
      forward: { on: "pares", has: "one", label: "doador", onDelete: "cascade" },
      reverse: { on: "participantes", has: "one", label: "doando" },
    },
    parReceptor: {
      forward: { on: "pares", has: "one", label: "receptor", onDelete: "cascade" },
      reverse: { on: "participantes", has: "one", label: "recebidoDe" },
    },
    grupoCapa: {
      forward: { on: "grupos", has: "one", label: "capa" },
      reverse: { on: "$files", has: "one", label: "grupoCapa" },
    },
  },
  rooms: {},
});

type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
