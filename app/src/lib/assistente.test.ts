import { expect, test } from "bun:test";
import { linkAdicionarAoClaude } from "./assistente";

test("link do Claude tem nome e URL do MCP codificados", () => {
  expect(linkAdicionarAoClaude()).toBe(
    "https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Amigo%20Secreto&connectorUrl=https%3A%2F%2Famigo-mcp.app.tpou.gy%2Fmcp",
  );
});
