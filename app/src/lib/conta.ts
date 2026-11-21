// "Minha conta": exportar meus dados (função pura, testada em conta.test.ts) e o plano de
// "apagar minha conta" (o plano vive em @amigo/dominio porque o worker o executa).
import { formatarCodigo, type DadosConta } from "@amigo/dominio";

export { APELIDO_REMOVIDO, planoApagarConta, resumoPlano, type OperacaoConta } from "@amigo/dominio";

/** Tudo de que /conta precisa, numa consulta (as regras recortam: só o que é meu, e o meu par). */
export function consultaConta(usuarioId: string) {
  return {
    $users: {
      $: { where: { id: usuarioId } },
      participacoes: {
        grupo: { campos: {} },
        respostas: { campo: {} },
        doando: { sorteio: {}, receptor: {} },
      },
      gruposOrganizados: { campos: {} },
    },
  };
}

type Data = string | number | Date | null | undefined;
type CampoBruto = {
  id: string;
  rotulo: string;
  tipo: string;
  obrigatorio: boolean;
  ordem: number;
  opcoes?: unknown;
  ajuda?: string | null;
};
type GrupoBruto = {
  id: string;
  titulo: string;
  status: string;
  rodadaAtual: number;
  rodadaBase?: number | null;
  codigo?: string;
  campos?: CampoBruto[];
};

/** O resultado de `consultaConta` (o `$users`), de forma estrutural: campos a mais são ignorados. */
export type DadosExportacao = {
  id: string;
  email?: string | null;
  participacoes?: {
    id: string;
    apelido: string;
    entrouEm?: Data;
    removido?: boolean;
    grupo?: GrupoBruto | null;
    respostas?: { id: string; valor: unknown; campo?: { id: string; rotulo: string } | null }[];
    doando?: {
      sorteio?: { rodada: number } | null;
      receptor?: { id: string; apelido: string } | null;
    } | null;
  }[];
  gruposOrganizados?: (GrupoBruto & { codigo: string })[];
};

const iso = (d: Data) => (d == null ? null : new Date(d).toISOString());

/**
 * JSON de "Exportar meus dados": e-mail, participações (grupo, apelido, respostas com o rótulo
 * do campo, e quem EU tirei na rodada atual) e grupos organizados (título, código, campos).
 * Monta cada campo explicitamente: nada de outras pessoas passa (participantes, respostas e
 * pares alheios), além do apelido de quem eu tirei.
 */
export function montarExportacao(d: DadosExportacao, agora = new Date()) {
  const participacoes = (d.participacoes ?? [])
    .filter((p) => !p.removido && p.grupo)
    .map((p) => {
      const g = p.grupo!;
      const ordem = new Map((g.campos ?? []).map((c) => [c.id, c.ordem]));
      const respostas = (p.respostas ?? [])
        .filter((r) => r.campo)
        .sort((a, b) => (ordem.get(a.campo!.id) ?? 0) - (ordem.get(b.campo!.id) ?? 0))
        .map((r) => ({ campo: r.campo!.rotulo, valor: r.valor }));
      const par = p.doando;
      const vigente = par?.receptor && par.sorteio?.rodada === g.rodadaAtual && g.rodadaAtual >= 1;
      return {
        grupo: { id: g.id, titulo: g.titulo, status: g.status },
        participanteId: p.id,
        apelido: p.apelido,
        entrouEm: iso(p.entrouEm),
        respostas,
        quemEuTirei: vigente ? { participanteId: par!.receptor!.id, apelido: par!.receptor!.apelido } : null,
      };
    });
  const gruposOrganizados = (d.gruposOrganizados ?? []).map((g) => ({
    id: g.id,
    titulo: g.titulo,
    codigo: formatarCodigo(g.codigo),
    status: g.status,
    campos: [...(g.campos ?? [])]
      .sort((a, b) => a.ordem - b.ordem)
      .map((c) => ({
        rotulo: c.rotulo,
        tipo: c.tipo,
        obrigatorio: c.obrigatorio,
        ...(c.ajuda ? { ajuda: c.ajuda } : {}),
        ...(Array.isArray(c.opcoes) ? { opcoes: c.opcoes as string[] } : {}),
      })),
  }));
  return {
    geradoEm: agora.toISOString(),
    conta: { email: d.email ?? null },
    participacoes,
    gruposOrganizados,
  };
}

export function nomeArquivoExportacao(agora = new Date()): string {
  return `amigo-secreto-meus-dados-${agora.toISOString().slice(0, 10)}.json`;
}

/** Os mesmos dados, no formato de `planoApagarConta` (para a confirmação mostrar o que vai acontecer). */
export function dadosParaPlano(d: DadosExportacao): DadosConta {
  return {
    usuarioId: d.id,
    participacoes: (d.participacoes ?? []).flatMap((p) =>
      p.grupo && !p.removido
        ? [{
            participanteId: p.id,
            grupoId: p.grupo.id,
            status: p.grupo.status,
            rodadaAtual: p.grupo.rodadaAtual,
            rodadaBase: p.grupo.rodadaBase ?? null,
            respostas: (p.respostas ?? []).map((r) => r.id),
          }]
        : [],
    ),
    gruposOrganizados: (d.gruposOrganizados ?? []).map((g) => g.id),
  };
}
