# Amigo Secreto — Design do piloto

**Data:** 2026-11-20 · **Status:** aprovado (Thomaz, 2026-11-20)
**Fonte de produto:** `discussion/ideias.md` (v2). Este documento **não repete** o produto (fluxos, telas, modelo de dados, permissões, testes): ele fixa a arquitetura, as decisões de stack e os ajustes ao `ideias.md`. Onde os dois divergirem, vale este.

---

## 1. Intenção

O amigo secreto é um **piloto da stack do Pluto**: um app pequeno e real, usado por pessoas de verdade, que exercita os mesmos problemas difíceis do Pluto (segredo por usuário, papel administrativo sem acesso a dado alheio, estrutura definida em dados, worker no servidor, MCP). O que importa no fim não é só o app funcionar, mas **responder às perguntas da seção 10 do `ideias.md`** e registrar os achados.

### Objetivos
- App utilizável em `amigo.tpou.gy` para um amigo secreto real (ex.: amigo livro).
- Validar a stack de ponta a ponta: Bun, instantdb-rust self-hosted, SvelteKit SPA + neobrutalism-svelte no Cloudflare, worker com OpenWorkflow, MCP com Google.
- Deixar como herança para o Pluto: a suíte de permissões por `asUser`, o módulo de worker e o roteiro de deploy de apps de projeto no Dokku.

### Não-objetivos
- Os itens da seção 9 do `ideias.md` (plano alimentar, ingestão de PDF, agentes com IA, volume, Nutri em escala).
- Alta disponibilidade: a VPS é única e desliga às 04:30 todo dia.
- Login por e-mail (magic code): o servidor não envia e-mails.

### Anti-objetivos (falhou mesmo se "funcionar")
- O organizador, ou qualquer participante, conseguir ver um par que não é o seu, por qualquer caminho (UI, console, MCP, painel).
- Um sorteio rodar duas vezes e trocar os pares depois de alguém já ter visto o seu.
- Dados pessoais (pares, respostas) aparecerem em logs ou no painel do OpenWorkflow.
- O piloto quebrar ou degradar o Instant ou outros serviços da VPS.

---

## 2. Restrições

| Restrição | Origem | Consequência |
|---|---|---|
| **Bun, nunca Node**, versão **≥ 1.4** fixada | Thomaz; o spike mostrou que o painel quebra no Bun 1.3.12 | `packageManager`/`engines` e imagem `oven/bun` fixados por digest |
| VPS de 2 GB (≈1,2 GB livres), build da imagem na própria VPS | `~/pessoal/vps` | Serviços leves; meta de RAM do piloto ≤ 250 MB somando worker, painel e MCP |
| VPS desliga ~04:30 todo dia | Backup de imagem do provedor | Worker e MCP precisam retomar sozinhos; nada pode depender de ficar sempre ligado |
| Instant em `https://instant.tpou.gy`; sem dashboard | `docs/plataforma-instant.md` | App criado com `bin/instant-new-app` (repo da VPS); schema/perms via `bunx instant-cli push` |
| Login só Google (OIDC); origens autorizadas explícitas | Idem | Cadastrar `amigo.tpou.gy`, as URLs de preview e `localhost:<porta>` |
| Só `@instantdb/admin` 1.0.67 validado | Idem | ⚠️ `@instantdb/svelte` e `@instantdb/core` com instantdb-rust são **a primeira coisa a validar** |
| Apps/volumes Dokku do projeto são **do projeto** | Thomaz | Provisionamento versionado neste repo; prefixo `amigo-`; não tocar em apps de outros projetos nem nos serviços basais |
| Regras do repo da VPS | `~/pessoal/vps/CLAUDE.md` | Imagens fixadas por digest (nunca `:latest`), segredos fora do git, nada de expor Postgres |

---

## 3. Arquitetura

```
                Cloudflare (amigo.tpou.gy)
                ┌──────────────────────────┐
  navegador ───▶│ SvelteKit SPA (estático) │
                └────────────┬─────────────┘
                             │ WebSocket / HTTPS (@instantdb/svelte)
                             ▼
VPS ─────────────────────────────────────────────────────────────────────
  instant (instant.tpou.gy) ◀──────── admin SDK ─────────┐
        ▲         │ subscribeQuery (sorteios pendentes)  │
        │         ▼                                      │
        │   amigo-worker (Bun) ── OpenWorkflow ── /data/ow.db (volume amigo-workflows)
        │                                                    ▲
        │   amigo-painel (Bun) ── @openworkflow/dashboard ───┘   127.0.0.1:3999
        │
        └── amigo-mcp (Bun, amigo-mcp.app.tpou.gy) ── asUser
─────────────────────────────────────────────────────────────────────────
  Thomaz: ssh -N -L 3999:127.0.0.1:3999 vps-mercurio → http://localhost:3999
```

O **Instant é a fonte de verdade** e a única coisa com que o navegador fala. Permissões, `ruleParams` e `rateLimit` ficam todos no Instant. O OpenWorkflow guarda só o **estado de execução** (runs, passos, tentativas), que é descartável.

---

## 4. Worker

### 4.1 Abordagens consideradas

| Abordagem | Prós | Contras | Decisão |
|---|---|---|---|
| A. Instant como fila, com lease/tentativas/log escritos à mão | Zero serviço novo; tudo reativo e com backup | Reinventa a roda (lease, retry, passos, visibilidade) | Descartada |
| B. Absurd (Postgres) | Maduro, em produção, durável de verdade | Exige um 2º Postgres na VPS só para isso | Descartada |
| C. Webhook do Instant → endpoint Bun | Push em vez de assinatura | Webhooks não testados no instantdb-rust; retry incerto | Descartada (pode virar teste extra) |
| **D. OpenWorkflow + SQLite (`bun:sqlite`)** | Passos memorizados, retry com backoff, lease com heartbeat, idempotência, cron, painel web; um processo; sem serviço novo de banco | Pré-1.0; idempotência nativa só vale por 24 h; painel exige Bun ≥ 1.4 | **Escolhida** |

Alternativas descartadas na pesquisa: absurd-sqlite (alpha parada), bunqueue (o painel não vê o modo embutido, timeout de 30 s por passo), reflow-ts (um único mantenedor; fica como **plano B**, porque tem API e recursos equivalentes).

### 4.2 Resultados do spike (`spikes/openworkflow/`, descartável)

Retry com backoff ✅ · idempotência por chave ✅ · `kill -9` no meio de um passo: retoma após o lease (~30 s) e refaz só o passo interrompido ✅ · passo de 90 s mantido pelo heartbeat ✅ · RSS do worker ~64 MB ✅ · painel ~40 MB ocioso / ~85–105 MB em uso ✅ (só com Bun 1.4.5) · SIGTERM espera o run inteiro terminar ⚠️.

### 4.3 Fluxo do sorteio

1. O organizador clica em **Sortear**. O cliente cria `sorteios` com `status: "pendente"` e `chave: "<grupoId>:<rodada>"`, um atributo **único**, para que dois cliques gerem só um sorteio. A permissão e o `rateLimit` ficam no Instant.
2. O worker assina via `subscribeQuery` os sorteios `pendente`. Para cada um, chama `ow.runWorkflow(sortear, { sorteioId }, { idempotencyKey: sorteioId })`.
3. O workflow `sortear` tem estes passos, **cada um idempotente**:
   1. `carregar`: lê participantes e restrições pelo admin SDK. Se o sorteio não está mais `pendente`/`processando`, termina sem fazer nada.
   2. `marcar-processando`: grava o status no Instant.
   3. `sortear`: chama `dominio/sortear()`, que é pura. A seed é **`HMAC-SHA256(SORTEIO_SEGREDO, sorteioId)`**, calculada no worker, para que uma reexecução gere os mesmos pares. A seed não é guardada no resultado do passo (nem no `ow.db`, nem em log): cada passo a recalcula. O `SORTEIO_SEGREDO` vive **só** no `dokku config` do `amigo-worker` (gerado na VPS por `infra/provisionar.sh`, nunca regenerado), e o worker se recusa a subir sem ele.
      - *Por quê (revisão do piloto):* a 1ª versão usava o próprio `sorteioId` como seed. Membros veem o `sorteioId` e os ids dos participantes, o organizador vê as restrições, e o `sorteioId` é gerado no cliente pelo organizador: qualquer um recalcularia todos os pares offline com `dominio/sortear`, e o organizador poderia gerar ids até obter o par que quisesse. Com o HMAC, sem o segredo do worker a seed é imprevisível.
   4. `gravar-pares`: cada par usa uma chave única (`<sorteioId>:<doadorId>`), então regravar não duplica. Na mesma transação, o sorteio vira `concluido` e o grupo vira `sorteado`.
4. **Falha definitiva** (por exemplo, restrições impossíveis, que não devem ser tentadas de novo): o status vira `erro` com uma mensagem legível, e a UI mostra "tentar de novo", o que cria um novo sorteio.

### 4.4 Garantias contra duplicidade (três camadas)

1. **Instant:** a `chave` única impede dois sorteios para a mesma rodada.
2. **OpenWorkflow:** `idempotencyKey = sorteioId` impede dois runs. Essa garantia só vale por 24 h.
3. **Passos:** o `carregar` confere o status no Instant, e os pares têm chave única. Isso cobre o caso de mais de 24 h ou de o `ow.db` ter sido perdido.

### 4.5 Retomada e operação

- **Ao subir**, o worker processa o que a assinatura entrega: tudo que está `pendente` (pela camada 2) e os `processando` órfãos (o próprio OpenWorkflow retoma os seus pelo lease). Se o `ow.db` sumir, a camada 3 garante que reprocessar é seguro.
- **SIGTERM** (deploy/04:30): o worker para de pegar trabalho novo. O Dokku manda SIGKILL após o timeout, e a retomada vem pelo lease. Ajustar `dokku ps:set amigo-worker stop-timeout-seconds` para algo como 30 s.
- **Logs:** só metadados (ids, nomes de passo, duração, erro). **Nunca** nomes, pares ou respostas, nem no input/output dos passos visível no painel. O input é só `{ sorteioId }`, e os passos devolvem ids opacos ou contagens.
- **Reutilização no Pluto:** a cola entre Instant e OpenWorkflow (assinar → enfileirar → status no Instant) fica num módulo genérico `worker/nucleo/`, separado dos workflows do amigo secreto.

### 4.6 Painel

- App Dokku `amigo-painel`, que monta o **mesmo volume** e roda `@openworkflow/dashboard` fixado (0.1.12) sob Bun ≥ 1.4, com `DO_NOT_TRACK=1`.
- Porta publicada **só em `127.0.0.1:3999` da VPS**, sem Nginx e sem domínio. O acesso é por túnel SSH, via script `bin/painel`, que abre o túnel e o navegador.
- ⚠️ A ligação de porta via `docker-options` pode conflitar com o deploy sem downtime. Se conflitar, desligar o zero-downtime só nesse app.
- ⚠️ O painel abre o SQLite em leitura e escrita (pode cancelar e reexecutar). Escrita concorrente com o worker em WAL deve funcionar, mas é preciso validar.

---

## 5. Front

- **SvelteKit em modo SPA** (`adapter-static` com `fallback`, `ssr = false`), porque o registry do neobrutalism-svelte é feito para SvelteKit. Isso troca o "Svelte SPA + shadcn-svelte" do `ideias.md` §8.
- **neobrutalism-svelte** (olegpolin, MIT, Svelte 5 + Tailwind 4): componentes adicionados via `bunx shadcn-svelte add https://neobrutalism-svelte.flenze.com/r/<comp>.json`. Eles são **copiados para o repo**, o que dilui o risco de o projeto, que é pequeno, ser abandonado. Componentes previstos: `sidebar`, `sheet`, `dialog`, `tabs`, `card`, `field`, `input`, `textarea`, `select`, `checkbox`, `radio-group`, `badge`, `progress`, `sonner`, `skeleton`, `empty`.
- O que falta no registry e terá de ser feito aqui: o **stepper** do onboarding (com `progress` + `card`), a **exibição e leitura de QR** (biblioteca à parte) e o editor de **lista de itens**.
- **Deploy:** Cloudflare Pages (escolha do Thomaz, previsto no doc da plataforma). Nota: o Cloudflare recomenda Workers com assets estáticos para projetos novos. Para uma SPA, os dois servem, e a migração é trivial.
- **Build com Bun** (`bun --bun vite build`).

---

## 6. Infra do projeto na VPS

| App Dokku | Processo | Rede | Volume |
|---|---|---|---|
| `amigo-worker` | `worker` (sem `web`, sem Nginx) | Só saída | `amigo-workflows` → `/data` |
| `amigo-painel` | Painel | `127.0.0.1:3999` | `amigo-workflows` → `/data` |
| `amigo-mcp` | `web` | `amigo-mcp.app.tpou.gy` (Let's Encrypt) | — |

- Dockerfiles `FROM oven/bun:<versão>@sha256:<digest>`, cada serviço com seu `build-dir`, deploy por `git push dokku@vps-mercurio:<app> main`.
- Os scripts de provisionamento, que são idempotentes, ficam em `infra/` neste repo: criar app, volume, montagem, `config:set` sem segredos, timeout de parada e portas.
- Segredos (admin token do Instant, client secret do Google) ficam no Bitwarden e no `dokku config`. Nunca no git.
- O app no Instant, o client OAuth e as origens autorizadas seguem `docs/plataforma-instant.md` do repo da VPS.

---

## 7. Estrutura do repositório

Workspaces do Bun:

```
amigo-secreto/
├── app/                 # SvelteKit SPA + neobrutalism-svelte + @instantdb/svelte
├── instant.schema.ts
├── instant.perms.ts
├── dominio/             # sortear(), código, temas, validação de respostas + bun test
├── worker/
│   ├── nucleo/          # cola genérica Instant ↔ OpenWorkflow (herança p/ Pluto)
│   └── workflows/       # sortear
├── painel/              # Dockerfile do @openworkflow/dashboard
├── mcp/                 # fastmcp + Google
├── ingestao/            # seed
├── testes/permissoes.ts # suíte asUser
├── infra/               # provisionamento Dokku do projeto
├── bin/painel           # túnel SSH + abrir navegador
└── spikes/              # descartáveis
```

---

## 8. Ajustes e acréscimos ao `ideias.md`

- **§4 Modelo:**
  - `sorteios` ganha `chave` (única) e `rodada`.
  - `pares` ganha `chave` (única); `participantes` ganha `viuParNaRodada`.
  - `grupos` ganha `rodadaAtual`.
  - `participantes` ganha `removido`.
  - O status do sorteio é escrito só pelo worker (admin).
- **§7.1 Infra:**
  - Validar `@instantdb/svelte` contra o instantdb-rust (login, query reativa, transação).
  - Validar que fastmcp roda no Bun e ⚠️ conferir se a versão TS (punkpeye) tem mesmo um `GoogleProvider`, porque esse nome é do FastMCP em Python.
  - Medir a RAM de worker, painel e MCP somados.
- **§7.6 Worker, testes adicionais:**
  - `kill -9` no meio de `gravar-pares` → nenhum par duplicado.
  - Apagar o `ow.db` com sorteio pendente → reprocessa sem duplicar.
  - Simular o desligamento das 04:30 (parar `instant` e worker juntos) → tudo retoma.
  - Painel e logs sem nenhum dado pessoal.
  - `curl` de fora para a porta 3999 da VPS → recusado.
  - Cancelar e reexecutar pelo painel com o worker rodando → sem corrupção.

---

## 9. Decisões de produto tomadas na revisão (Thomaz, 2026-11-20)

- **Escopo:** todas as funcionalidades do `ideias.md` entram, inclusive MCP, painel, Streams, capa e exportação. Não há prazo apertado: o evento real é depois da implementação.
- **Refazer sorteio:**
  - O app registra quando cada participante **abre o próprio par pela primeira vez** (`participantes.viuParNaRodada`, escrito pelo próprio participante).
  - Enquanto ninguém viu, o organizador refaz com uma confirmação simples.
  - Depois que alguém viu, refazer exige **confirmação forte** mostrando quantos já viram. Os nomes não aparecem, para não vazar quem está em qual par.
  - Refazer **apaga os pares da rodada anterior**, incrementa `rodada` e cria um novo `sorteio`.
  - Limite de **3 rodadas** por grupo.
  - A regra de leitura de `respostas` ("quem tirou o dono") considera só os pares da rodada atual, o que vem de graça porque os antigos são apagados.
- **Sair depois do sorteio:** só pelo organizador, que remove o participante. Remover depois do sorteio **obriga a refazer**, e a UI leva direto para o fluxo de refazer.
- **Apagar a conta:** o participante vira **"removido"**: perde o vínculo com `$users`, as respostas são apagadas e o nome fica como "participante removido". O organizador é avisado de que precisa refazer o sorteio, caindo na regra acima.
- **Google OAuth publicado** (sem modo de teste), só com os escopos `openid`, `email` e `profile`. Isso exige tela de consentimento, página de **política de privacidade** e termos simples em `amigo.tpou.gy`, que passam a fazer parte do front.

- **Execução autônoma da infra:** o SSH para `vps-mercurio` e o DNS já estão prontos. O implementador provisiona apps Dokku, volumes, app no Instant e deploys **sem pedir confirmação**, respeitando as regras do repo da VPS e sem tocar em apps de outros projetos.
- **Login no início:** até o Thomaz configurar o Google OAuth, o login é por **magic code**. O código aparece no log do Instant (`ssh vps-mercurio 'dokku logs instant'`), e o e-mail de teste é o do Thomaz. O Google é a última peça, configurada por ele.
- **MCP:** usa o `fastmcp` do punkpeye, que **já tem `GoogleProvider`** (confirmado pelo Thomaz).

### Decisões do autor (corrigíveis)
- **Plano B da prévia por código:** se `ruleParams` ou `rateLimit` não funcionarem no instantdb-rust, a prévia passa por um endpoint HTTP no `amigo-worker`, com o admin token, rate limit próprio e resposta só com os campos públicos do grupo. O worker ganha então um processo `web` em `amigo-api.app.tpou.gy`.
- **Uso do `asUser`:** o MCP guarda o admin token e age sempre via `asUser({ email })` do usuário autenticado no OAuth do MCP. Fica coberto pela suíte de permissões.

## 10. Pendências marcadas ⚠️ (validar antes de depender)

1. `@instantdb/svelte` + instantdb-rust.
2. Porta em `127.0.0.1` vs deploy sem downtime no Dokku.
3. Escrita concorrente painel/worker no SQLite.
4. fastmcp rodando no Bun (o `GoogleProvider` existe).
5. `ruleParams` e as regras via `data.ref` de `respostas` (quem tirou o dono), conforme `ideias.md` §5.

## 11. Deixado para quem implementar

- Granularidade exata dos passos e nomes de arquivos.
- A biblioteca de QR (geração e leitura) e o fallback da `BarcodeDetector`.
- O valor exato de `leaseDurationMs` e da concorrência do worker (sugestão: o lease padrão de 30 s e concorrência 2).
- O visual fino dentro do estilo neobrutalista (paleta, tipografia do tema padrão do registry).
