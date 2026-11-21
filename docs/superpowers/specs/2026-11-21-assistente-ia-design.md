# Seção "Use com seu assistente de IA" — design curto

**Data:** 2026-11-21 · **Status:** aprovado (Thomaz testou o deep link do Claude: abre a janela já preenchida)

## Intenção
Facilitar a conexão do MCP (`https://amigo-mcp.app.tpou.gy/mcp`), porque hoje é preciso preencher à mão a janela de conector personalizado.

## Abordagens
- **Deep link do Claude + copiar URL + instruções para o ChatGPT (escolhida).** O link `claude.ai/customize/connectors?modal=add-custom-connector&connectorName=…&connectorUrl=…` não é documentado, mas foi testado. O ChatGPT não tem link de um clique.
- Diretórios oficiais (Anthropic e OpenAI): exigem submissão e revisão, o que é demais para o piloto.
- Só instruções: pior experiência, e o link funciona.

## Comportamento
- Componente `AssistenteIA.svelte`, mostrado no fim de **Meus grupos** (`/grupos`) e em **Minha conta** (`/conta`).
- Título: **"Use com seu assistente de IA"**. Texto: "Pergunte ao Claude ou ao ChatGPT quem você tirou e peça sugestões de presente com base no perfil da pessoa. Ele só vê o que você vê."
- Botão **"Adicionar ao Claude"**: abre em nova aba
  `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Amigo%20Secreto&connectorUrl=https%3A%2F%2Famigo-mcp.app.tpou.gy%2Fmcp`
  (gerado com `encodeURIComponent` a partir de constantes). Abaixo, a nota: "Depois clique em Adicionar e entre com a mesma conta Google. No plano gratuito do Claude cabe um conector personalizado."
- Botão **"Copiar URL do MCP"**: copia `https://amigo-mcp.app.tpou.gy/mcp` e mostra o toast "URL copiada".
- **ChatGPT** (bloco recolhível "Como adicionar no ChatGPT"): "Em Configurações, ative o modo desenvolvedor e adicione um conector (app) com a URL acima. Os nomes do menu mudam entre versões e planos; precisa de plano pago."
- **Exemplos** de perguntas: "Quem eu tirei no amigo livro?", "Me sugere 3 livros para quem eu tirei, evitando os que a pessoa já leu" e "Atualiza meu perfil: gosto de fantasia e suspense".
- As constantes (URL do MCP, nome e função que monta o link) ficam em `app/src/lib/assistente.ts`, com teste unitário do link gerado.

## Fora do escopo
Submissão aos diretórios oficiais; detectar se o conector já foi adicionado.
