// O worker não sobe sem SORTEIO_SEGREDO válido: log claro e saída != 0, antes de tocar no Instant.
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAIN = join(import.meta.dir, "main.ts");

function rodar(segredo: string | undefined) {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
  if (segredo !== undefined) env.SORTEIO_SEGREDO = segredo;
  // cwd vazio: o Bun não carrega nenhum .env.
  const cwd = mkdtempSync(join(tmpdir(), "worker-main-"));
  const r = Bun.spawnSync([process.execPath, MAIN], { env, cwd, stdout: "pipe", stderr: "pipe" });
  return { codigo: r.exitCode, saida: r.stdout.toString() + r.stderr.toString() };
}

describe("worker/main.ts", () => {
  test("sem SORTEIO_SEGREDO: recusa subir", () => {
    const r = rodar(undefined);
    expect(r.codigo).not.toBe(0);
    expect(r.saida).toContain('"evento":"worker.segredo_invalido"');
    expect(r.saida).toContain("SORTEIO_SEGREDO ausente");
  });

  test("SORTEIO_SEGREDO curto: recusa subir sem ecoar o valor", () => {
    const r = rodar("curto-demais-123");
    expect(r.codigo).not.toBe(0);
    expect(r.saida).toContain("SORTEIO_SEGREDO curto");
    expect(r.saida).not.toContain("curto-demais-123");
  });
});
