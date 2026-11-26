// O que os handlers do worker compartilham.
import type { InstantAdminDatabase } from "@instantdb/admin";
import type { RetryPolicy } from "instant-commands/worker";
import type { AppSchema } from "@amigo/instant";

export type AdminDb = InstantAdminDatabase<AppSchema>;

/**
 * Política dos passos que tocam o Instant: falha transitória (rede, Instant reiniciando,
 * desligamento das 04:30) é refeita com backoff. 300 tentativas, 1 s → 60 s: ~5 h no total.
 * Os passos são idempotentes, então insistir é seguro. Esgotadas as tentativas, a biblioteca
 * marca o pedido `failed` com o `defaultErrorMessage` do handler. Só os testes a sobrescrevem.
 */
export const RETRY_PASSO_PADRAO: RetryPolicy = {
  maximumAttempts: 300,
  initialInterval: "1s",
  backoffCoefficient: 2,
  maximumInterval: "60s",
};
