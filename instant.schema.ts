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
      // rodadaAtual no momento da última reabertura (ausente = 0): o limite de 3 sorteios vale
      // por abertura (rodada − rodadaBase ≤ 3). Só o worker (admin) grava.
      rodadaBase: i.number().optional(),
      criadoEm: i.date(),
      // Apelido do organizador, gravado na criação: a prévia e a página mostram "Organizado por".
      organizadorApelido: i.string().optional(),
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
      // Rodada em que o participante foi removido (só se removido depois de um sorteio).
      removidoNaRodada: i.number().optional(),
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
    // Pedido de "apagar minha conta": o cliente cria, o worker (workflow `apagar-conta`) executa.
    pedidosExclusao: i.entity({
      criadoEm: i.date(),
      status: i.string().indexed(), // pendente | concluido
    }),
    // Pedido de "reabrir o grupo" (desfazer o sorteio): o organizador cria, o worker (workflow
    // `reabrir-grupo`) apaga os pares, reabre o grupo e grava `rodadaBase`.
    reaberturas: i.entity({
      status: i.string().indexed(), // pendente | concluido | erro
      erro: i.string().optional(),
      criadoEm: i.date(),
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
    // Sem cascata nos participantes: quem sai do grupo não precisa (nem pode) apagar restrições;
    // a restrição fica órfã, o sorteio a ignora e o organizador a vê como "Ignorada".
    restricaoParticipanteA: {
      forward: { on: "restricoes", has: "one", label: "participanteA" },
      reverse: { on: "participantes", has: "many", label: "restricoesA" },
    },
    restricaoParticipanteB: {
      forward: { on: "restricoes", has: "one", label: "participanteB" },
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
    pedidoExclusaoUsuario: {
      forward: { on: "pedidosExclusao", has: "one", label: "usuario" },
      reverse: { on: "$users", has: "many", label: "pedidosExclusao" },
    },
    reaberturaGrupo: {
      forward: { on: "reaberturas", has: "one", label: "grupo", onDelete: "cascade" },
      reverse: { on: "grupos", has: "many", label: "reaberturas" },
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
