// Preserva a intenção (criar / entrar com código) através do login.
// Sem dependência do Svelte: testável com `bun test` e um Storage em memória.

export type Intencao = { tipo: "criar" } | { tipo: "entrar"; codigo?: string };

const CHAVE = "amigo:intencao";

function ehIntencao(v: unknown): v is Intencao {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.tipo === "criar") return true;
  return o.tipo === "entrar" && (o.codigo === undefined || typeof o.codigo === "string");
}

export function guardarIntencao(i: Intencao, storage: Storage = sessionStorage): void {
  storage.setItem(CHAVE, JSON.stringify(i));
}

/** Lê e apaga a intenção guardada (uso único). */
export function consumirIntencao(storage: Storage = sessionStorage): Intencao | null {
  const bruto = storage.getItem(CHAVE);
  if (bruto === null) return null;
  storage.removeItem(CHAVE);
  try {
    const v: unknown = JSON.parse(bruto);
    return ehIntencao(v) ? v : null;
  } catch {
    return null;
  }
}

export function destinoAposLogin(i: Intencao | null): string {
  if (!i) return "/grupos";
  if (i.tipo === "criar") return "/criar";
  return i.codigo ? `/g/${encodeURIComponent(i.codigo)}` : "/entrar-grupo";
}

/**
 * Intenção implícita numa rota interna aberta sem login (ex.: link `/g/KQ7M4P` vindo do QR),
 * para o guarda de autenticação guardar antes de mandar para `/entrar`.
 */
export function intencaoDaRota(pathname: string): Intencao | null {
  if (pathname === "/criar" || pathname.startsWith("/criar/")) return { tipo: "criar" };
  if (pathname === "/entrar-grupo") return { tipo: "entrar" };
  const m = /^\/g\/([^/]+)\/?$/.exec(pathname);
  if (m) {
    try {
      return { tipo: "entrar", codigo: decodeURIComponent(m[1]) };
    } catch {
      return { tipo: "entrar" };
    }
  }
  return null;
}
