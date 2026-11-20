import { log } from "./log";

export type Assinatura<T> = (
  aoReceber: (itens: T[]) => void,
  aoErro: (e: unknown) => void,
) => { fechar(): void };

const BACKOFF_PADRAO = [1000, 2000, 5000, 10000, 30000];

/**
 * Campainha: transforma uma assinatura (ex.: subscribeQuery do Instant) em disparos.
 * A cada entrega chama `disparar` para cada item (entregas repetidas são normais; a
 * idempotência é do `disparar`). Em erro, fecha e reassina após o backoff, que zera
 * na primeira entrega bem-sucedida. A reassinatura recebe de novo o estado atual,
 * então pendentes acumulados durante a queda são processados.
 */
export function iniciarCampainha<T>(opts: {
  nome: string;
  assinar: Assinatura<T>;
  chave: (item: T) => string;
  disparar: (item: T, chave: string) => Promise<void>;
  backoffMs?: number[];
}): { parar(): void } {
  const backoff = opts.backoffMs?.length ? opts.backoffMs : BACKOFF_PADRAO;
  const { nome } = opts;
  let parada = false;
  let falhas = 0;
  let atual: { fechar(): void } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let geracao = 0;

  const fecharAtual = () => {
    try {
      atual?.fechar();
    } catch {
      // fechar é melhor esforço
    }
    atual = undefined;
  };

  function aoFalhar(minha: number) {
    if (parada || minha !== geracao) return; // assinatura obsoleta ou erro repetido
    geracao++; // invalida callbacks da assinatura que caiu
    fecharAtual();
    const espera = backoff[Math.min(falhas, backoff.length - 1)]!;
    falhas++;
    log("campainha.reconectar", { nome, esperaMs: espera, falhas });
    timer = setTimeout(abrir, espera);
  }

  async function aoReceber(minha: number, itens: T[]) {
    if (parada || minha !== geracao) return;
    falhas = 0;
    log("campainha.entrega", { nome, itens: itens.length });
    for (const item of itens) {
      let chave = "";
      try {
        chave = opts.chave(item);
        await opts.disparar(item, chave);
      } catch (e) {
        // só o nome do tipo do erro: a mensagem pode conter dados
        log("campainha.disparo_falhou", { nome, chave, erro: e instanceof Error ? e.name : "desconhecido" });
      }
    }
  }

  function abrir() {
    timer = undefined;
    if (parada) return;
    const minha = ++geracao;
    try {
      atual = opts.assinar(
        (itens) => void aoReceber(minha, itens),
        (e) => {
          log("campainha.erro", { nome, erro: e instanceof Error ? e.name : "desconhecido" });
          aoFalhar(minha);
        },
      );
    } catch (e) {
      log("campainha.erro", { nome, erro: e instanceof Error ? e.name : "desconhecido" });
      aoFalhar(minha);
      return;
    }
    // erro síncrono durante assinar() já invalidou a geração: fecha o que acabou de abrir
    if (minha !== geracao) fecharAtual();
    else log("campainha.assinada", { nome });
  }

  abrir();

  return {
    parar() {
      parada = true;
      geracao++;
      if (timer) clearTimeout(timer);
      timer = undefined;
      fecharAtual();
      log("campainha.parada", { nome });
    },
  };
}

/** Mínimo estrutural do admin SDK que usamos (evita acoplar a genéricos de schema). */
type DbComAssinatura = {
  subscribeQuery(
    query: any,
    cb: (payload: any) => void,
  ): { close(): void };
};

/**
 * Adapta `db.subscribeQuery` (admin 1.0.67) para `Assinatura`. O payload `ok` traz
 * `data: { <entidade>: itens[] }`; os itens de todas as entidades da consulta são achatados.
 * Payload `error` chama `aoErro`.
 */
export function assinaturaInstant<T = any>(db: DbComAssinatura, consulta: object): Assinatura<T> {
  return (aoReceber, aoErro) => {
    const sub = db.subscribeQuery(consulta, (payload) => {
      if (payload.type === "error") {
        aoErro(payload.error);
        return;
      }
      const itens: T[] = [];
      for (const v of Object.values(payload.data ?? {})) if (Array.isArray(v)) itens.push(...(v as T[]));
      aoReceber(itens);
    });
    return { fechar: () => sub.close() };
  };
}
