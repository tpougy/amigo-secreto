// Seed do sorteio: HMAC-SHA256(SORTEIO_SEGREDO, sorteioId), calculada só no worker.
// O `sorteioId` é visível aos membros (e escolhido pelo organizador no cliente), e os ids dos
// participantes e as restrições também; com a seed = sorteioId qualquer um recalcularia os pares
// offline com `dominio/sortear`, e o organizador poderia "garimpar" ids até gostar do resultado.
// O segredo vive só no `dokku config` do `amigo-worker`. A seed nunca vai para log nem ow.db.
import { createHmac } from "node:crypto";

/** Tamanho mínimo do segredo (32 bytes em hex, como gera `openssl rand -hex 32`). */
export const SEGREDO_MIN = 64;

/** Valida o segredo; lança com mensagem curta (sem o valor) se faltar ou for curto. */
export function validarSegredo(segredo: string | undefined): string {
  if (!segredo) throw new Error("SORTEIO_SEGREDO ausente");
  if (segredo.length < SEGREDO_MIN) throw new Error(`SORTEIO_SEGREDO curto (mínimo ${SEGREDO_MIN} caracteres)`);
  return segredo;
}

/** Seed determinística por sorteio: reexecutar o mesmo sorteio gera os mesmos pares. */
export function seedDoSorteio(segredo: string, sorteioId: string): string {
  return createHmac("sha256", validarSegredo(segredo)).update(sorteioId).digest("hex");
}
