// Lógica pura do assistente "Criar grupo" (sem runes, para ser testável com `bun test`).
// A página guarda um `Estado` em `$state` e chama estas funções.
import { camposIniciais, TEMAS, type Tema, type TipoCampo } from "@amigo/dominio";

export const ETAPAS = ["Tema", "Sobre", "Datas e regras", "Campos", "Revisão", "Compartilhar"] as const;
/** Índice da etapa "Compartilhar" (a última). */
export const ETAPA_COMPARTILHAR = ETAPAS.length - 1;

export const TIPOS_CAMPO: { valor: TipoCampo; nome: string }[] = [
  { valor: "texto-curto", nome: "Texto curto" },
  { valor: "texto-longo", nome: "Texto longo" },
  { valor: "lista", nome: "Lista de itens" },
  { valor: "multipla", nome: "Múltipla escolha" },
  { valor: "unica", nome: "Escolha única" },
];

export type CampoEditavel = {
  /** Identificador local (só para a UI; o id real nasce na hora de gravar). */
  chave: string;
  rotulo: string;
  ajuda: string;
  tipo: TipoCampo;
  opcoes: string[];
  obrigatorio: boolean;
};

export type Estado = {
  etapa: number;
  temaId: Tema["id"];
  titulo: string;
  descricao: string;
  /** `YYYY-MM-DD` ou vazio. */
  dataSorteio: string;
  dataEvento: string;
  /** Texto digitado; vazio = sem valor sugerido. */
  valor: string;
  campos: CampoEditavel[];
  /** O organizador mexeu nos campos depois de escolher o tema. */
  camposEditados: boolean;
};

export const temOpcoes = (t: TipoCampo) => t === "multipla" || t === "unica";

let contador = 0;
export function novaChave(): string {
  contador += 1;
  return `c${Date.now().toString(36)}${contador}`;
}

export function novoCampo(): CampoEditavel {
  return { chave: novaChave(), rotulo: "", ajuda: "", tipo: "texto-curto", opcoes: [], obrigatorio: false };
}

function camposDoTema(temaId: Tema["id"]): CampoEditavel[] {
  return camposIniciais(temaId).map((c) => ({
    chave: novaChave(),
    rotulo: c.rotulo,
    ajuda: c.ajuda ?? "",
    tipo: c.tipo,
    opcoes: c.opcoes ?? [],
    obrigatorio: c.obrigatorio,
  }));
}

export function estadoInicial(temaId: Tema["id"] = "livro"): Estado {
  return {
    etapa: 0,
    temaId,
    titulo: "",
    descricao: "",
    dataSorteio: "",
    dataEvento: "",
    valor: "",
    campos: camposDoTema(temaId),
    camposEditados: false,
  };
}

/** Troca o tema e substitui os campos pelos do novo tema. A UI confirma antes se `camposEditados`. */
export function trocarTema(estado: Estado, temaId: Tema["id"]): Estado {
  return { ...estado, temaId, campos: camposDoTema(temaId), camposEditados: false };
}

export function nomeDoTema(temaId: string): string {
  return TEMAS.find((t) => t.id === temaId)?.nome ?? temaId;
}

/** Valor sugerido em número, ou `null` se vazio. `NaN` se inválido. */
export function valorNumerico(valor: string): number | null {
  const t = valor.trim().replace(",", ".");
  if (t === "") return null;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

/** Erros (mensagens em pt-BR) da etapa `n`. Lista vazia = pode avançar. */
export function validarEtapa(n: number, estado: Estado): string[] {
  const erros: string[] = [];
  if (n === 1) {
    const t = estado.titulo.trim().length;
    if (t < 3 || t > 80) erros.push("O título precisa ter de 3 a 80 caracteres.");
    if (estado.descricao.trim().length > 500) erros.push("A descrição pode ter no máximo 500 caracteres.");
  }
  if (n === 2) {
    if (estado.dataSorteio && estado.dataEvento && estado.dataEvento < estado.dataSorteio) {
      erros.push("A data do evento não pode ser anterior à data prevista do sorteio.");
    }
    const v = valorNumerico(estado.valor);
    if (v !== null && (Number.isNaN(v) || v < 0)) erros.push("O valor sugerido precisa ser um número maior ou igual a 0.");
  }
  if (n === 3) {
    estado.campos.forEach((c, i) => {
      const nome = `Campo ${i + 1}`;
      if (c.rotulo.trim() === "") erros.push(`${nome}: informe o rótulo.`);
      if (temOpcoes(c.tipo) && c.opcoes.map((o) => o.trim()).filter(Boolean).length < 2) {
        erros.push(`${nome}${c.rotulo.trim() ? ` (${c.rotulo.trim()})` : ""}: informe pelo menos 2 opções.`);
      }
    });
  }
  return erros;
}

/** Erros de todas as etapas de dados (1 a 3), com a primeira etapa que falhou. */
export function validarTudo(estado: Estado): { etapa: number; erros: string[] } | null {
  for (const n of [1, 2, 3]) {
    const erros = validarEtapa(n, estado);
    if (erros.length) return { etapa: n, erros };
  }
  return null;
}

export type Ids = {
  grupoId: string;
  codigo: string;
  participanteId: string;
  /** Um id por campo, na ordem de `estado.campos`. */
  campoIds: string[];
  usuarioId: string;
  apelido: string;
  /** Epoch ms de "agora". */
  agora: number;
};

export type Operacao = {
  entidade: "grupos" | "campos" | "participantes";
  id: string;
  dados: Record<string, unknown>;
  links: Record<string, string>;
};

/** `fulano@x.com` → `fulano`. */
export function apelidoDoEmail(email: string | null | undefined): string {
  const parte = (email ?? "").split("@")[0]?.trim();
  return (parte || "Organizador").slice(0, 40);
}

export function dataIso(d: string): string {
  return new Date(`${d}T12:00:00`).toISOString();
}

/** Operações da transação ÚNICA: 1 grupo + N campos + 1 participante (o organizador). */
export function paraTransacao(estado: Estado, ids: Ids): Operacao[] {
  const valor = valorNumerico(estado.valor);
  const descricao = estado.descricao.trim();
  const grupo: Operacao = {
    entidade: "grupos",
    id: ids.grupoId,
    dados: {
      titulo: estado.titulo.trim(),
      ...(descricao ? { descricao } : {}),
      tema: estado.temaId,
      codigo: ids.codigo,
      ...(estado.dataSorteio ? { dataSorteioPrevista: dataIso(estado.dataSorteio) } : {}),
      ...(estado.dataEvento ? { dataEvento: dataIso(estado.dataEvento) } : {}),
      ...(valor !== null && !Number.isNaN(valor) ? { valorSugerido: valor } : {}),
      status: "aberto",
      rodadaAtual: 0,
      criadoEm: ids.agora,
      organizadorApelido: ids.apelido,
    },
    links: { organizador: ids.usuarioId },
  };
  const campos: Operacao[] = estado.campos.map((c, i) => {
    const ajuda = c.ajuda.trim();
    return {
      entidade: "campos",
      id: ids.campoIds[i]!,
      dados: {
        rotulo: c.rotulo.trim(),
        ...(ajuda ? { ajuda } : {}),
        tipo: c.tipo,
        ...(temOpcoes(c.tipo) ? { opcoes: c.opcoes.map((o) => o.trim()).filter(Boolean) } : {}),
        obrigatorio: c.obrigatorio,
        ordem: i,
      },
      links: { grupo: ids.grupoId },
    };
  });
  const participante: Operacao = {
    entidade: "participantes",
    id: ids.participanteId,
    dados: {
      apelido: ids.apelido,
      perfilCompleto: false,
      removido: false,
      entrouEm: ids.agora,
      chave: `${ids.grupoId}:${ids.usuarioId}`,
    },
    links: { grupo: ids.grupoId, usuario: ids.usuarioId },
  };
  return [grupo, ...campos, participante];
}


/** O erro do Instant é `record-not-unique`? (colisão do código) */
export function ehColisao(e: unknown): boolean {
  const b = (e as { body?: { type?: string } })?.body;
  return b?.type === "record-not-unique";
}
