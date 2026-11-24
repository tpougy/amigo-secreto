import { describe, expect, test } from "bun:test";
import { assinaturaSchema, precisaLimpar } from "./cacheInstant";
import schema from "@amigo/instant";

describe("cache do Instant", () => {
  test("assinatura é estável e muda com o schema", () => {
    expect(assinaturaSchema(schema)).toBe(assinaturaSchema(schema));
    expect(assinaturaSchema({ a: 1 })).not.toBe(assinaturaSchema({ a: 2 }));
  });

  test("sem assinatura ou com outra limpa; igual não", () => {
    expect(precisaLimpar(null, "x")).toBe(true);
    expect(precisaLimpar("y", "x")).toBe(true);
    expect(precisaLimpar("x", "x")).toBe(false);
  });
});
