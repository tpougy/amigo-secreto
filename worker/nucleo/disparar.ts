import type { defineWorkflowSpec, OpenWorkflow } from "openworkflow";

/**
 * Garante um run vivo (ou concluído) para `chave`. A `idempotencyKey` dura 24 h e devolveria
 * para sempre um run `failed`; nesse caso abre UM run novo com a chave
 * `<chave>:retry:<idDoRunFalho>`: determinística, então entregas repetidas da campainha caem
 * no mesmo run. Se esse também falhar, a próxima entrega encadeia outro.
 * (Não usar `rerunWorkflowRun`: sem chave, cada entrega criaria um rerun concorrente.)
 */
export async function dispararComRetomada<Input, Output>(
  ow: OpenWorkflow,
  spec: ReturnType<typeof defineWorkflowSpec<Input, Output>>,
  input: Input,
  chave: string,
): Promise<void> {
  let h = await ow.runWorkflow(spec, input, { idempotencyKey: chave });
  while (h.workflowRun.status === "failed") {
    h = await ow.runWorkflow(spec, input, { idempotencyKey: `${chave}:retry:${h.workflowRun.id}` });
  }
}
