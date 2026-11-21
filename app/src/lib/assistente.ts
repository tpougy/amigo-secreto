// Seção "Use com seu assistente de IA": constantes e link de um clique do Claude.
export const NOME_CONECTOR = "Amigo Secreto";
export const URL_MCP = "https://amigo-mcp.app.tpou.gy/mcp";
const BASE_CLAUDE = "https://claude.ai/customize/connectors";

/** Deep link (não documentado, mas testado) que abre o "conector personalizado" já preenchido. */
export function linkAdicionarAoClaude(): string {
  return `${BASE_CLAUDE}?modal=add-custom-connector&connectorName=${encodeURIComponent(NOME_CONECTOR)}&connectorUrl=${encodeURIComponent(URL_MCP)}`;
}
