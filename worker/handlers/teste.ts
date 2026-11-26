// Só para os testes de integração dos handlers: um runner real da biblioteca, em modo
// `subscription`, sobre um OpenWorkflow SQLite num diretório temporário (apagado em `parar()`).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";
import type { Handler, Runner, RunnerEvent, Schedule, UniqueHandlers, UniqueSchedules } from "instant-commands/worker";
import type { AppSchema } from "@amigo/instant";
import { createRunner } from "../commands";
import type { AdminDb } from "./comum";

export type OpcoesRunnerTeste<Ss extends readonly Schedule<AppSchema, string>[]> = {
  /** O admin do app de TESTE (`adminTeste()`). */
  db: AdminDb;
  schedules?: Ss;
  /** Chamado em cada evento, além de guardá-lo em `eventos`. */
  onEvent?: (e: RunnerEvent) => void;
};

export type RunnerTeste = {
  runner: Runner;
  /** Todos os eventos do runner, em ordem. Pode trazer pedidos de outros prefixos: filtre pelo id. */
  eventos: RunnerEvent[];
  /** Para o runner, fecha o SQLite e apaga o diretório temporário. */
  parar(): Promise<void>;
};

/**
 * Sobe `createRunner({ trigger: { type: "subscription" }, concurrency: 1 })` com `handlers`, num
 * OpenWorkflow SQLite novo, e espera o `start()`. A assinatura pode pegar pedidos abertos que
 * outros testes deixaram no app de teste: cada teste confere só os próprios ids.
 */
export async function rodarComRunner<
  const Hs extends readonly Handler<any, AppSchema>[],
  const Ss extends readonly Schedule<AppSchema, string>[] = [],
>(handlers: Hs & UniqueHandlers<Hs>, opcoes: OpcoesRunnerTeste<Ss & UniqueSchedules<Hs, Ss>>): Promise<RunnerTeste> {
  const dir = mkdtempSync(join(tmpdir(), "amigo-ow-teste-"));
  const backend = BackendSqlite.connect(join(dir, "ow.db"));
  const ow = new OpenWorkflow({ backend });
  const eventos: RunnerEvent[] = [];
  const runner = createRunner<Hs, Ss>({
    ow,
    db: opcoes.db,
    handlers,
    ...(opcoes.schedules ? { schedules: opcoes.schedules } : {}),
    trigger: { type: "subscription" },
    concurrency: 1,
    onEvent: (e) => {
      eventos.push(e);
      opcoes.onEvent?.(e);
    },
  });
  let parado = false;
  async function parar() {
    if (parado) return;
    parado = true;
    try {
      await runner.stop();
    } finally {
      await backend.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  }
  try {
    await runner.start();
  } catch (e) {
    await parar();
    throw e;
  }
  return { runner, eventos, parar };
}
