import { expect, test } from "bun:test";
import { emailDoIdToken } from "./google";

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
