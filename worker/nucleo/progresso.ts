import { log } from "./log";

/** Mínimo do admin SDK usado aqui (streams do Instant). */
type DbComStreams = {
  streams: { createWriteStream(opts: { clientId: string }): WritableStream<string> };
};

const abertos = new Map<string, WritableStreamDefaultWriter<string>>();

/**
 * Progresso por Instant Stream (`clientId`), uma linha por fase (`fase\n`). Melhor esforço:
 * nunca lança nem atrasa o passo que chama (a UI tem o `status` como fallback). O escritor
 * fica aberto entre as fases do mesmo processo; `final` fecha o stream.
 */
export function escreverFase(db: DbComStreams, clientId: string, fase: string, final = false): void {
  try {
    let w = abertos.get(clientId);
    if (!w) {
      w = db.streams.createWriteStream({ clientId }).getWriter();
      abertos.set(clientId, w);
    }
    const escritor = w;
    escritor.write(`${fase}\n`).catch(() => {});
    if (final) {
      abertos.delete(clientId);
      escritor.close().catch(() => {});
    }
  } catch (e) {
    abertos.delete(clientId);
    log("progresso.falhou", { fase, erro: e instanceof Error ? e.name : "desconhecido" });
  }
}
