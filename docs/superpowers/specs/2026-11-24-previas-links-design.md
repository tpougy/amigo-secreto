# Prévias de link (Open Graph) — design curto

**Data:** 2026-11-24 · **Status:** aprovado (Thomaz)

## Intenção
Mostrar um cartão (imagem, título e descrição) quando um link do site é colado no WhatsApp, no Teams e em outros apps. A prévia do site é diferente da de convite. Sem custo nem script no Worker: o front continua só com arquivos estáticos.

## Abordagens
- **Arquivos estáticos (escolhida).** As tags vão no `index.html` (site) e num `convite/index.html` próprio (convite). Os robôs não executam JavaScript, então só conta o HTML servido.
- Script no Worker com prévia por grupo (título e capa): descartado pelo Thomaz, por fugir do modelo só com arquivos e trazer risco de custo e disponibilidade.
- `svelte-meta-tags`: não serve, porque com `ssr = false` as tags só aparecem depois do JS rodar.

## Comportamento
- **Site:** as tags `og:*`, `twitter:card` e `description` ficam em `app/src/app.html`. Imagem `https://amigo.tpou.gy/og/site.png`.
- **Convite:** `app/static/convite/index.html` é uma página HTML mínima, com as tags do convite e a imagem `https://amigo.tpou.gy/og/convite.png`. Um script inline lê `?c=`:
  - se o código for válido (normalizado: letras e números, sem hífen nem espaço, 6 caracteres), redireciona com `location.replace` para `/g/<CODIGO>`;
  - senão, redireciona para `/entrar-grupo`.
  - Tem um `<noscript>` com link para o site. Não tem `og:url`, porque não dá para saber o código no HTML estático.
- **Link compartilhado:** o "Copiar link" e o "Compartilhar" do `Compartilhar.svelte` passam a usar `<origem>/convite/?c=<CODIGO>`. A barra no fim evita o redirecionamento de `/convite` para `/convite/` no Worker. O QR continua com `/g/<CODIGO>`, que é mais curto e é aberto pela câmera, sem prévia.
- **Leitor de QR:** `codigoDeQR` também aceita `.../convite/?c=<CODIGO>`.
- **Links antigos `/g/…`:** continuam funcionando, com a prévia do site.
- **Imagens:** 1200×630 em PNG, no estilo neobrutalista do site (fundo creme, bordas pretas grossas, sombra dura, âmbar `amber-400` e azul, DM Sans). Ficam em `app/static/og/`.
  - São geradas uma única vez por `app/scripts/og-imagens.ts`, com `satori` e `@resvg/resvg-js` como dependências de desenvolvimento. Os PNGs são versionados.
- **Textos:**
  - Site: "Amigo Secreto" / "Sorteio, perfis de gostos e dicas de presente para o seu grupo."
  - Convite: "Você foi convidado para um amigo secreto!" / "Toque para entrar no grupo e montar seu perfil."

## Fora do escopo
Prévia por grupo, que precisa de servidor.
