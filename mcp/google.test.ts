import { expect, test } from "bun:test";
import type { GoogleSession } from "fastmcp/auth";
import { emailDoIdToken, sessaoComEmail } from "./google";

const jwt = (claims: object) =>
  ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "assinatura"].join(".");

test("emailDoIdToken lê só e-mail verificado", () => {
  expect(emailDoIdToken(jwt({ email: "Fulana@Gmail.com", email_verified: true }))).toBe("fulana@gmail.com");
  expect(emailDoIdToken(jwt({ email: "a@b.c", email_verified: false }))).toBeUndefined();
  expect(emailDoIdToken(jwt({ email: "a@b.c" }))).toBeUndefined();
  expect(emailDoIdToken(jwt({ email_verified: true }))).toBeUndefined();
  expect(emailDoIdToken("lixo")).toBeUndefined();
  expect(emailDoIdToken("a.%%%.c")).toBeUndefined();
  expect(emailDoIdToken(undefined)).toBeUndefined();
});

test("sessaoComEmail: id_token, senão userinfo; sem e-mail verificado, recusa (undefined)", async () => {
  const base = { accessToken: "tok" } as GoogleSession;
  const nunca = async () => {
    throw new Error("não devia chamar o userinfo");
  };
  const comId = { ...base, idToken: jwt({ email: "A@b.c", email_verified: true }) } as GoogleSession;
  expect((await sessaoComEmail(comId, nunca))?.email).toBe("a@b.c");
  expect((await sessaoComEmail(base, async () => "u@b.c"))?.email).toBe("u@b.c");
  expect(await sessaoComEmail(base, async () => undefined)).toBeUndefined();
  const naoVerificado = { ...base, idToken: jwt({ email: "a@b.c", email_verified: false }) } as GoogleSession;
  expect(await sessaoComEmail(naoVerificado, async () => undefined)).toBeUndefined();
  expect(await sessaoComEmail(undefined, nunca)).toBeUndefined();
});
