// Ajustes no `GoogleProvider` do fastmcp 4.28.4 (ver discussion/ideias.md §10):
// 1. Ele declara `GoogleSession.email`, mas nunca o preenche: o `createSession` herdado só copia os
//    tokens. Aqui o e-mail vem do `id_token` (recebido direto do endpoint de token do Google, por
//    TLS, então dispensa checar a assinatura — OIDC Core §3.1.3.7) e, se faltar (refresh sem
//    `id_token`), do endpoint `userinfo` com o access token.
// 2. Ele não pede `access_type=offline`: sem refresh token do Google, a sessão do MCP morre junto
//    com o access token (1 h). `prompt=consent` garante que o Google mande o refresh token de novo.
import { GoogleProvider, OAuthProxy, type GoogleSession } from "fastmcp/auth";
import type { IncomingMessage } from "node:http";

const USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";

type Claims = { email?: unknown; email_verified?: unknown };

function emailVerificado(c: Claims | null | undefined): string | undefined {
  if (!c || typeof c.email !== "string" || !c.email) return undefined;
  // O Google manda `email_verified` como booleano (id_token) ou, às vezes, "true" (userinfo antigo).
  if (c.email_verified !== true && c.email_verified !== "true") return undefined;
  return c.email.toLowerCase();
}

/** E-mail verificado das claims de um id_token do Google (sem checar assinatura; ver acima). */
export function emailDoIdToken(idToken: string | undefined): string | undefined {
  const payload = idToken?.split(".")[1];
  if (!payload) return undefined;
  try {
    return emailVerificado(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  } catch {
    return undefined;
  }
}

/**
 * Completa a sessão com o e-mail verificado (id_token, senão userinfo). Sem e-mail verificado a
 * sessão é recusada (`undefined` → 401 e o cliente refaz o login): uma sessão sem e-mail não
 * identifica o usuário no Instant.
 */
export async function sessaoComEmail(
  sessao: GoogleSession | undefined,
  porUserinfo: (accessToken: string) => Promise<string | undefined>,
): Promise<GoogleSession | undefined> {
  if (!sessao) return undefined;
  const email = emailDoIdToken(sessao.idToken) ?? (await porUserinfo(sessao.accessToken));
  return email ? { ...sessao, email } : undefined;
}

export class GoogleComEmail extends GoogleProvider {
  // Cache curto do userinfo por access token (o fallback roda no máximo uma vez por token).
  private emails = new Map<string, string>();

  protected override createProxy(): OAuthProxy {
    return new OAuthProxy({
      ...this.forwardedProxyOptions,
      allowedRedirectUriPatterns: this.config.allowedRedirectUriPatterns,
      baseUrl: this.config.baseUrl,
      consentRequired: this.config.consentRequired ?? true,
      encryptionKey: this.config.encryptionKey,
      extraAuthorizationParams: { access_type: "offline", prompt: "consent" },
      jwtSigningKey: this.config.jwtSigningKey,
      scopes: this.config.scopes ?? this.getDefaultScopes(),
      tokenStorage: this.config.tokenStorage,
      upstreamAuthorizationEndpoint: this.getAuthorizationEndpoint(),
      upstreamClientId: this.config.clientId,
      upstreamClientSecret: this.config.clientSecret,
      upstreamTokenEndpoint: this.getTokenEndpoint(),
    });
  }

  override async authenticate(request: IncomingMessage | undefined): Promise<GoogleSession | undefined> {
    return sessaoComEmail(await super.authenticate(request), (t) => this.emailPorUserinfo(t));
  }

  private async emailPorUserinfo(accessToken: string): Promise<string | undefined> {
    const salvo = this.emails.get(accessToken);
    if (salvo) return salvo;
    try {
      const r = await fetch(USERINFO, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) return undefined;
      const email = emailVerificado((await r.json()) as Claims);
      if (email) {
        if (this.emails.size > 500) this.emails.clear();
        this.emails.set(accessToken, email);
      }
      return email;
    } catch {
      return undefined;
    }
  }
}
