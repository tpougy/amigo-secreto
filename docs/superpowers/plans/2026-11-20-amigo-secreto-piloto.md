# Amigo Secreto (piloto) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pôr no ar o app de amigo secreto temático completo (front, regras de permissão, worker de sorteio com OpenWorkflow, painel, MCP, seed), rodando na VPS e no Cloudflare. A única pendência no final é o Thomaz configurar o Google OAuth.

**Architecture:** O navegador fala só com o Instant self-hosted (`instant.tpou.gy`), que guarda todos os dados e aplica todas as permissões. Um worker Bun assina os sorteios pendentes e os executa como workflows duráveis do OpenWorkflow (estado em SQLite num volume Dokku). Um painel do OpenWorkflow fica em `127.0.0.1:3999`, acessível por túnel SSH. Um servidor MCP (fastmcp + Google) age como o usuário via `asUser`.

**Tech Stack:**
- Bun 1.4.5
- TypeScript
- SvelteKit 3 (SPA, `adapter-static`) + Svelte 5 + Tailwind 4 + neobrutalism-svelte (registry do shadcn-svelte)
- `@instantdb/svelte`, `@instantdb/admin` e `instant-cli` 1.0.67
- `openworkflow` 0.11.0 e `@openworkflow/dashboard` 0.1.12
- `fastmcp` 4.28.4
- Zod
- Dokku 0.38 na VPS `vps-mercurio`
- Cloudflare Pages via `bunx --bun wrangler@4`

**Spec:** `docs/superpowers/specs/2026-11-20-amigo-secreto-design.md` (arquitetura e decisões) + `discussion/ideias.md` (produto: fluxos, telas, modelo, permissões, testes). Executores leem os dois. Onde divergirem, vale o design.

## Global Constraints

- **Runtime:** Bun **1.4.5** em tudo: local (`bun upgrade`), `"packageManager": "bun@1.4.5"` no `package.json` raiz e `FROM oven/bun:1.4.5@sha256:<digest>` nos Dockerfiles. **Nunca Node.** Ferramentas que exigem Node rodam com `bunx --bun`.
- **Versões:**
  - Dependências fixadas sem `^`: `@instantdb/*` e `instant-cli` `1.0.67`, `openworkflow` `0.11.0`, `@openworkflow/dashboard` `0.1.12`, `fastmcp` `4.28.4`.
  - Imagens Docker fixadas por digest. Nunca `:latest`.
- **Instant:** `apiURI: "https://instant.tpou.gy"`, `websocketURI: "wss://instant.tpou.gy/runtime/session"`. Há dois apps Instant:
  - `amigo-secreto` (produção);
  - `amigo-secreto-teste` (todos os testes de integração). **Testes nunca usam o app de produção**, exceto o e2e da Task 9, que limpa o que cria.
- **Segredos:**
  - `.env` na raiz (gitignored) com `INSTANT_APP_ID`, `INSTANT_ADMIN_TOKEN`, `INSTANT_TEST_APP_ID`, `INSTANT_TEST_ADMIN_TOKEN`; na VPS ficam em `dokku config`.
  - Nunca imprimir admin tokens na conversa nem em logs. Nunca commitá-los.
  - As cópias canônicas estão em `/root/instant-apps/<nome>.env` na VPS.
- **Infra autônoma:** pode criar e deployar apps Dokku do projeto **com prefixo `amigo-`** sem pedir confirmação. Fica proibido:
  - tocar em `instant`, `s3` e `backup-files`;
  - reiniciar o Instant;
  - mexer em `/home/dokku/instant`;
  - qualquer ação destrutiva fora dos apps `amigo-*`.
- **Endereços:**
  - Front: `https://amigo.tpou.gy`, domínio próprio do projeto `amigo-secreto` no Pages; fallback `https://amigo-secreto.pages.dev`.
  - MCP: `https://amigo-mcp.app.tpou.gy` (o DNS curinga `*.app.tpou.gy` já aponta para a VPS).
  - Painel: `127.0.0.1:3999` só na VPS.
- **Código do grupo:** 6 caracteres do alfabeto `BCDFGHJKMNPQRSTVWXZ23456789`, exibido como `XXX-XXX`. A entrada aceita minúsculas e ignora hífen e espaços.
- **Rodadas e limites:** no máximo **3 rodadas** de sorteio por grupo e mínimo de **3 participantes ativos** para sortear.
- **Logs** (worker, MCP) e **inputs/outputs de passos do OpenWorkflow** contêm só ids, contagens e nomes de passo. **Nunca** nomes de pessoas, pares ou respostas.
- **Textos de UI em português do Brasil.** Estilo neobrutalista (componentes do registry `https://neobrutalism-svelte.flenze.com/r/<comp>.json`).
- **Login:**
  - Magic code ligado por `PUBLIC_LOGIN_MAGIC=on`; o código é lido do log do Instant ou de `/admin/magic_code`.
  - Google ligado por `PUBLIC_LOGIN_GOOGLE=on`, usando o client `google` no Instant. Ele começa desligado e o Thomaz liga no fim.
  - E-mail do Thomaz para testes manuais: `thomazpougy@gmail.com`.
- **Commits:**
  - pequenos, um por step de commit, na branch `piloto`;
  - mensagens em português no formato `tipo(escopo): resumo`;
  - terminar com as linhas de atribuição `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_01QpztnEyRLvtHmCb1a9kbXu`.
- **Registro de achados:** toda surpresa da stack vira uma linha na tabela §10 de `discussion/ideias.md` (data, área, o que aconteceu, impacto no Pluto, ação).

## Review Focus

1. **Código digitado com ruído.** Exemplos: `kq7 m4p`, `KQ7-M4P `, `kq7m4p`, ou caracteres fora do alfabeto como `0`, `O`, `1`, `I`. O esperado é normalizar o que é válido e recusar o resto com a mensagem "Código inválido", nunca consultar o Instant com lixo. *Teste na Task 2.*
2. **Grupo com menos de 3 participantes ativos, ou com restrições que citam participante removido.** O esperado é erro claro "São necessários pelo menos 3 participantes", e restrições órfãs são ignoradas, não fazem o sorteio falhar. *Testes nas Tasks 3 e 8.*
3. **Campo ou opção removidos depois de haver respostas.** A validação do perfil ignora respostas de campos inexistentes. Uma opção de múltipla escolha que deixou de existir é descartada no recálculo, e `perfilCompleto` é recalculado sem exceção. *Teste na Task 4.*
4. **Membro logado abre `/g/CODIGO` do próprio grupo, ou de um grupo já sorteado.** Membro vai direto para a página do grupo. Não-membro de grupo sorteado vê "Este grupo já fez o sorteio" sem botão de entrar. *Teste na Task 12 (função pura de navegação).*
5. **A conexão do worker com o Instant cai** (desligamento das 04:30, redeploy do Instant). A assinatura é refeita com backoff e os pendentes acumulados são processados ao reconectar. *Teste na Task 7 (watchdog com assinatura falsa).*

---

## Mapa de arquivos

```
package.json                  # workspaces: dominio, worker, mcp, ingestao, app, painel
tsconfig.base.json
.env.example                  # nomes das variáveis, sem valores
instant.schema.ts             # schema único (raiz, convenção do instant-cli)
instant.perms.ts              # regras únicas
dominio/
  codigo.ts  sortear.ts  temas.ts  campos.ts  index.ts   (+ *.test.ts)
testes/
  instant-teste.ts            # helpers: admin do app de teste, criarUsuario, limpar
  permissoes.grupos.test.ts   permissoes.sorteio.test.ts   permissoes.conta.test.ts
worker/
  nucleo/campainha.ts  nucleo/log.ts  nucleo/status.ts   (+ testes)
  workflows/sortear.ts  (+ teste de integração)
  main.ts  Dockerfile  Procfile
painel/
  Dockerfile  openworkflow.config.ts
mcp/
  ferramentas.ts  servidor.ts  Dockerfile   (+ ferramentas.test.ts)
ingestao/
  seed.ts  exemplo.json   (+ seed.test.ts)
app/                          # SvelteKit SPA
  src/lib/instant.ts  src/lib/intencao.ts  src/lib/navegacao.ts  src/lib/components/ui/*
  src/routes/...              # ver Tasks 10–14
infra/
  provisionar.sh  deploy.sh  pages.sh  instant-origens.sh
bin/painel
testes/e2e-producao.ts
```

---

### Task 1: Fundação do repositório e apps Instant

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `.env.example`, `README.md` (esqueleto), `infra/instant-apps.sh`
- Create (não versionado): `.env`

**Interfaces:**
- Produces:
  - variáveis em `.env`: `INSTANT_API_URI=https://instant.tpou.gy`, `INSTANT_APP_ID`, `INSTANT_ADMIN_TOKEN`, `INSTANT_TEST_APP_ID`, `INSTANT_TEST_ADMIN_TOKEN`;
  - workspaces Bun `dominio`, `worker`, `mcp`, `ingestao`, `app`, `painel`;
  - script raiz `bun test` (roda os testes de todos os workspaces, exceto `app`).

- [ ] **Step 1: Atualizar o Bun.** Run: `bun upgrade && bun --version`. Expected: `1.4.5`. Se vier uma versão maior, instale exatamente a 1.4.5 (`curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.5"`).
- [ ] **Step 2: Criar o `package.json` raiz e os demais arquivos.**
  - `package.json`: `"private": true`, `"packageManager": "bun@1.4.5"`, `"workspaces"` como acima.
  - `tsconfig.base.json`: `strict`, `moduleResolution: "bundler"`, `target: "ES2023"`, `types: ["bun"]`.
  - `.gitignore`: `node_modules`, `.env`, `*.db*`, `app/build`, `app/.svelte-kit`, `dados/`.
  - `.env.example` com os nomes das variáveis.
- [ ] **Step 3: Escrever o `infra/instant-apps.sh`.**
  - Para cada nome (`amigo-secreto`, `amigo-secreto-teste`), roda `~/pessoal/vps/bin/instant-new-app <nome>` se `/root/instant-apps/<nome>.env` ainda não existe na VPS (checar com `ssh vps-mercurio test -e ...`).
  - Depois lê o arquivo via `ssh` e grava as variáveis em `.env` **sem ecoar nada no terminal**. Redirecione a saída de `instant-new-app` para `/dev/null`.
  - É idempotente.
- [ ] **Step 4: Rodar o script e conferir.** Run: `infra/instant-apps.sh && grep -c '^INSTANT_' .env`. Expected: `5`. Nenhum token aparece na saída.
- [ ] **Step 5: Commit.** `git add package.json tsconfig.base.json .gitignore .env.example README.md infra/instant-apps.sh && git commit -m "chore: fundação do repositório e apps Instant"`

---

### Task 2: `dominio/codigo.ts`

**Files:** Create `dominio/package.json` (`name: "@amigo/dominio"`), `dominio/codigo.ts`, `dominio/codigo.test.ts`, `dominio/index.ts`

**Interfaces:**
- Produces:
  - `ALFABETO_CODIGO = "BCDFGHJKMNPQRSTVWXZ23456789"`
  - `gerarCodigo(aleatorio?: (n: number) => Uint8Array): string`: 6 caracteres sem hífen; o padrão usa `crypto.getRandomValues`, por amostragem por rejeição, sem viés de módulo.
  - `normalizarCodigo(entrada: string): string | null`: devolve 6 caracteres maiúsculos válidos, ou `null`.
  - `formatarCodigo(codigo: string): string`: `"KQ7M4P"` → `"KQ7-M4P"`.

- [ ] **Step 1: Escrever os testes que falham.**
  - `normalizarCodigo` aceita `"kq7 m4p"`, `"KQ7-M4P "` e `"kq7m4p"`, todos virando `"KQ7M4P"`.
  - `normalizarCodigo` devolve `null` para `"KQ7M40"` (`0` fora do alfabeto), `"KQ7M4"` (5), `"KQ7M4PP"` (7), `"KQ7-M4O"` e `""`.
  - Em 10.000 gerações, todo código casa `/^[BCDFGHJKMNPQRSTVWXZ2-9]{6}$/` e passa em `normalizarCodigo(c) === c`.
  - `gerarCodigo(() => new Uint8Array([0,1,2,3,4,5]))` (com o gerador injetado devolvendo bytes fixos) é determinístico.
  - `formatarCodigo("KQ7M4P") === "KQ7-M4P"`.
- [ ] **Step 2: Rodar e ver falhar.** Run: `bun test dominio/codigo.test.ts`. Expected: FAIL (módulo inexistente).
- [ ] **Step 3: Implementar as três funções.** Para a rejeição: descarte bytes `>= 27*9 = 243`; use `byte % 27`.
- [ ] **Step 4: Rodar e ver passar.** Run: `bun test dominio/codigo.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(dominio): código do grupo"`

---

### Task 3: `dominio/sortear.ts`

**Files:** Create `dominio/sortear.ts`, `dominio/sortear.test.ts`

**Interfaces:**
- Produces:
  - `type Restricao = { a: string; b: string }`: nenhum dos dois pode tirar o outro, nos dois sentidos.
  - `type Par = { doador: string; receptor: string }`
  - `class ErroSorteio extends Error { codigo: "poucos-participantes" | "restricoes-impossiveis" }`
  - `sortear(participantes: string[], restricoes: Restricao[], seed: string): Par[]`
  - `seedDe(texto: string): string`: identidade documentada. O worker passa `sorteioId`.

- [ ] **Step 1: Escrever os testes que falham.**
  - Para 3 a 30 participantes e 200 seeds diferentes:
    - ninguém tira a si mesmo;
    - cada id aparece exatamente uma vez como doador e uma vez como receptor;
    - nenhum par viola uma restrição em qualquer sentido.
  - A mesma seed com os mesmos participantes, **em qualquer ordem de entrada**, gera os mesmos pares. Ordene os ids antes de embaralhar.
  - Seeds diferentes geram resultados diferentes em pelo menos 90% de 100 tentativas com 6 participantes.
  - Com 2 participantes, lança `ErroSorteio` com `codigo === "poucos-participantes"` e mensagem `"São necessários pelo menos 3 participantes"`.
  - Com 3 participantes `a,b,c` e restrições `a–b` e `a–c`, lança `codigo === "restricoes-impossiveis"` com mensagem `"As restrições tornam o sorteio impossível"`.
  - **Restrição citando um id que não está entre os participantes é ignorada** (Review Focus 2).
- [ ] **Step 2: Rodar e ver falhar.** Run: `bun test dominio/sortear.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementar.**
  - PRNG determinístico a partir da seed: mulberry32 sobre um hash FNV-1a da string.
  - Algoritmo:
    1. ordenar os ids;
    2. tentar até 1.000 embaralhamentos Fisher–Yates de um ciclo único (`receptor = embaralhado[(i+1) % n]`) que respeite as restrições;
    3. se nenhum servir, fazer backtracking completo sobre permutações sem ponto fixo;
    4. se o backtracking esgotar, lançar `restricoes-impossiveis`.
  - O ciclo único é preferível porque evita "pares fechados" (A↔B).
- [ ] **Step 4: Rodar e ver passar.** Run: `bun test dominio/sortear.test.ts`. Expected: PASS em menos de 2 s.
- [ ] **Step 5: Commit.** `git commit -m "feat(dominio): sorteio puro com restrições e seed"`

---

### Task 4: `dominio/temas.ts` e `dominio/campos.ts`

**Files:** Create `dominio/temas.ts`, `dominio/campos.ts`, `dominio/campos.test.ts`, `dominio/temas.test.ts`

**Interfaces:**
- Produces:
  - `type TipoCampo = "texto-curto" | "texto-longo" | "lista" | "multipla" | "unica"`
  - `type DefCampo = { id: string; rotulo: string; ajuda?: string; tipo: TipoCampo; opcoes?: string[]; obrigatorio: boolean; ordem: number }`
  - `type Tema = { id: "livro" | "livre" | "vinho" | "personalizado"; nome: string; descricao: string; campos: Omit<DefCampo, "id">[] }`
  - `TEMAS: Tema[]`
  - `camposIniciais(temaId: Tema["id"]): Omit<DefCampo,"id">[]`
  - `validarResposta(campo: DefCampo, valor: unknown): { ok: true; valor: ValorResposta } | { ok: false; erro: string }`
  - `type ValorResposta = string | string[]`
  - `perfilCompleto(campos: DefCampo[], respostas: Record<string /*campoId*/, unknown>): boolean`
  - `limparRespostas(campos: DefCampo[], respostas: Record<string, unknown>): Record<string, ValorResposta>`: descarta campos inexistentes e opções que não existem mais.

- [ ] **Step 1: Escrever os testes que falham.**
  - **Tema `livro`:** exatamente os 4 campos do `ideias.md` §3.3, nesta ordem e com estes tipos:
    1. "Livros que li recentemente" (`lista`, não obrigatório);
    2. "Gêneros que mais gosto" (`multipla`, obrigatório; opções `fantasia`, `romance`, `suspense`, `não ficção`, `clássicos`, `poesia`, `infantil`, `biografia`);
    3. "Livros que já tenho / não quero ganhar" (`lista`, não obrigatório);
    4. "Observações para quem me tirar" (`texto-longo`, não obrigatório).

    Nenhum campo de lista de desejos.
  - **Tema `livre`:** "Do que eu gosto" (`texto-longo`, obrigatório) e "Lista de desejos" (`lista`, não obrigatório).
  - **Tema `vinho`:** "Tipos de vinho que prefiro" (`multipla`: `tinto`, `branco`, `rosé`, `espumante`, `sobremesa`; obrigatório), "Uvas ou regiões favoritas" (`lista`) e "Observações" (`texto-longo`).
  - **Tema `personalizado`:** sem campos.
  - **`validarResposta`:**
    - `texto-curto` recusa mais de 120 caracteres e `texto-longo` mais de 2.000;
    - os textos chegam aparados (trim);
    - `lista` aceita no máximo 30 itens de até 120 caracteres e remove os vazios;
    - `multipla` recusa opção inexistente com o erro `"Opção inválida"`;
    - `unica` exige exatamente uma opção existente;
    - um tipo errado (número onde se espera string) dá `{ok:false}`.
  - **`perfilCompleto`:** falso se um obrigatório estiver vazio (string vazia ou lista vazia); verdadeiro quando só os não obrigatórios estão vazios.
  - **Review Focus 3:** respostas para o campo `x` removido são ignoradas por `perfilCompleto` e sumem em `limparRespostas`. Numa `multipla` com `["romance","terror"]`, se `terror` não existe mais, vira `["romance"]`. Nada lança exceção.
- [ ] **Step 2: Rodar e ver falhar.** Run: `bun test dominio/`. Expected: FAIL nos novos.
- [ ] **Step 3: Implementar com Zod onde ajudar.** Exporte tudo por `dominio/index.ts`.
- [ ] **Step 4: Rodar e ver passar.** Run: `bun test dominio/`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(dominio): temas e validação de campos"`

---

### Task 5: Schema, permissões de grupos/participantes/respostas e suíte de permissões

**Files:** Create `instant.schema.ts`, `instant.perms.ts`, `testes/package.json`, `testes/instant-teste.ts`, `testes/permissoes.grupos.test.ts`, `infra/instant-push.sh`

**Referência obrigatória:** a sintaxe de regras (CEL, `data.ref`, `ruleParams`, `$rateLimits`, `request.modifiedFields`) está em `https://github.com/tsconfigdotjson/instantdb-rust/blob/de47af86078cb435489f845ad755a8d6a044b9ce/docs/PARITY.md` e na documentação do InstantDB para permissões. `instant.perms.ts` é tipado com `InstantRules`.

**Schema** (nomes exatos; `i.string()` etc.):

| Entidade | Atributos |
|---|---|
| `grupos` | `titulo` string · `descricao` string opcional · `tema` string indexado · `codigo` string **único e indexado** · `dataSorteioPrevista` date opcional · `dataEvento` date opcional · `valorSugerido` number opcional · `status` string indexado (`aberto`/`sorteado`/`encerrado`) · `rodadaAtual` number (começa em 0) · `criadoEm` date |
| `campos` | `rotulo` · `ajuda` opcional · `tipo` · `opcoes` json opcional · `obrigatorio` boolean · `ordem` number |
| `participantes` | `apelido` string · `perfilCompleto` boolean · `removido` boolean · `viuParNaRodada` number opcional · `entrouEm` date · `chave` string **único** (`<grupoId>:<userId>`) |
| `respostas` | `valor` json · `chave` string **único** (`<participanteId>:<campoId>`) |
| `restricoes` | `motivo` string opcional |
| `sorteios` | `status` string indexado (`pendente`/`processando`/`concluido`/`erro`) · `erro` string opcional · `rodada` number · `chave` string **único** (`<grupoId>:<rodada>`) · `criadoEm` date · `concluidoEm` date opcional |
| `pares` | `chave` string **único** (`<sorteioId>:<doadorParticipanteId>`) |

| Link (forward → reverse) | Cardinalidade | onDelete |
|---|---|---|
| `grupos.organizador` → `$users.gruposOrganizados` | has one / many | — |
| `campos.grupo` → `grupos.campos` | one / many | cascade (apagar grupo apaga campos) |
| `participantes.grupo` → `grupos.participantes` | one / many | cascade |
| `participantes.usuario` → `$users.participacoes` | one / many | — (a conta é tratada na Task 6) |
| `respostas.participante` → `participantes.respostas` | one / many | cascade |
| `respostas.campo` → `campos.respostas` | one / many | cascade |
| `restricoes.grupo` → `grupos.restricoes` | one / many | cascade |
| `restricoes.participanteA` / `participanteB` → `participantes.restricoesA` / `restricoesB` | one / many | cascade |
| `sorteios.grupo` → `grupos.sorteios` | one / many | cascade |
| `pares.sorteio` → `sorteios.pares` | one / many | cascade |
| `pares.doador` → `participantes.doando` | one / one | cascade |
| `pares.receptor` → `participantes.recebidoDe` | one / one | cascade |
| `grupos.capa` → `$files.grupoCapa` | one / one | — |

**Regras desta task** (as de sorteio/pares/conta ficam na Task 6). "Membro" = `auth.id in data.ref('<caminho>.participantes.usuario.id')` ou organizador.

| Entidade | view | create | update | delete |
|---|---|---|---|---|
| `grupos` | membro ou organizador; **ou** `ruleParams.codigo == data.codigo` | autenticado e `auth.id in data.ref('organizador.id')` após criar | organizador, e `request.modifiedFields` sem `status`, `rodadaAtual`, `codigo`; exceção: o organizador pode pôr `status = 'encerrado'` | organizador |
| `campos` | membro do grupo; **ou** `ruleParams.codigo` igual ao código do grupo (prévia) | organizador do grupo | organizador | organizador |
| `participantes` | membros do mesmo grupo | o próprio usuário (`auth.id in data.ref('usuario.id')`), com `ruleParams.codigo in data.ref('grupo.codigo')` e `'aberto' in data.ref('grupo.status')`, mais o organizador entrando no próprio grupo; cobra `rateLimit.entrada.limit(auth.id)` | o próprio, só `apelido`, `perfilCompleto`, `viuParNaRodada` | organizador; ou o próprio **só se** `'aberto' in data.ref('grupo.status')` |
| `respostas` | o dono; ou quem tirou o dono: `auth.id in data.ref('participante.recebidoDe.doador.usuario.id')` | o dono | o dono | o dono ou o organizador (para limpeza de campo removido) |
| `restricoes` | organizador | organizador | organizador | organizador |

`$rateLimits`: `entrada` com 20 tokens, recarga de 20 por hora.

**Interfaces:**
- Produces:
  - `instant.schema.ts` com `export default schema` e `export type AppSchema`;
  - `testes/instant-teste.ts` exporta:
    - `adminTeste()`: admin `init` do app de teste, com schema;
    - `criarUsuario(prefixo: string): Promise<{ email: string; id: string; db: AdminComo }>`: e-mail `<prefixo>-<uuid>@teste.amigo`, criado via `db.auth.createToken`, com `db = admin.asUser({ email })`;
    - `criarGrupoTeste(org, opcoes?): Promise<{ grupoId: string; codigo: string }>`: cria o grupo **como o organizador** (não como admin), com 2 campos do tema `livro`;
    - `entrar(usuario, grupoId, codigo): Promise<string /*participanteId*/>`;
    - `limparTudo(prefixo)`: apaga via admin os grupos e usuários do prefixo.
  - `infra/instant-push.sh <prod|teste>`: roda `INSTANT_CLI_API_URI=$INSTANT_API_URI INSTANT_APP_ADMIN_TOKEN=... bunx --bun instant-cli@1.0.67 push --app <id> --yes`.

- [ ] **Step 1: Escrever o schema e as regras acima.** Depois rodar `infra/instant-push.sh teste`. Expected: aplica sem erro. `bunx --bun instant-cli@1.0.67 pull` num diretório temporário devolve um schema equivalente. Se a CLI recusar algo, registre o achado em `ideias.md` §10 e ajuste.
- [ ] **Step 2: Escrever `testes/permissoes.grupos.test.ts`** (`bun test`, timeout de 30 s por teste, `afterAll(limparTudo)`). Testes e asserções:
  1. Não-membro sem `ruleParams` consulta `grupos` → `[]`.
  2. Não-membro com `ruleParams: { codigo: <certo> }` consulta `grupos` com `where: { codigo }` → exatamente 1 grupo, e os campos do grupo também.
  3. Não-membro com código errado → `[]`.
  4. Não-membro com `ruleParams.codigo` certo consulta `grupos` **sem** `where` → só aquele grupo, nunca outros grupos do teste.
  5. Membro de outro grupo consulta o grupo G → `[]`.
  6. Entrar com o código certo → participante criado. Entrar de novo no mesmo grupo → erro `record-not-unique` (pela `chave`).
  7. Entrar com o código errado → `permission-denied`.
  8. Organizador tenta mudar `status` para `sorteado` → `permission-denied`. Mudar para `encerrado` → ok.
  9. Participante A não vê as `respostas` de B antes do sorteio. O dono vê as próprias.
  10. Participante tenta editar o perfil de outro → `permission-denied`.
  11. 21ª tentativa de entrada do mesmo usuário em 1 hora → erro `rate-limited`. Use um usuário dedicado e grupos fechados para gerar as falhas.
- [ ] **Step 3: Rodar.** Run: `bun test testes/permissoes.grupos.test.ts`. Expected: PASS. Se o rate limit (teste 11) não for cobrado num `create` negado, registre em §10 e troque a asserção pela que documenta o comportamento real. Nunca remova o teste.
- [ ] **Step 4: Aplicar em produção.** Run: `infra/instant-push.sh prod`. Expected: sem erro.
- [ ] **Step 5: Commit.** `git commit -m "feat(instant): schema, regras de grupos e suíte de permissões"`

---

### Task 6: Regras de sorteio, pares e conta

**Files:** Modify `instant.perms.ts`. Create `testes/permissoes.sorteio.test.ts`, `testes/permissoes.conta.test.ts`

**Regras:**

| Entidade | view | create | update | delete |
|---|---|---|---|---|
| `sorteios` | membros do grupo | organizador, com `data.status == 'pendente'`, `data.rodada <= 3`, `(data.rodada - 1) in data.ref('grupo.rodadaAtual')`, `'encerrado' not in data.ref('grupo.status')`; cobra `rateLimit.sorteio.limit(auth.id)` (5/hora) | `false` (só admin) | `false` |
| `pares` | só o doador: `auth.id in data.ref('doador.usuario.id')` | `false` | `false` | `false` |
| `$users` | o próprio | — | — | o próprio: `auth.id == data.id` |

**Interfaces:**
- Consumes: os helpers de `testes/instant-teste.ts` (Task 5).
- Produces: `simularWorker(admin, sorteioId, pares: Par[])` em `testes/instant-teste.ts`, que grava pares, conclui o sorteio e atualiza o grupo **como admin**. Os testes usam esse helper até o worker existir.

- [ ] **Step 1: Escrever `permissoes.sorteio.test.ts`.** Grupo com organizador O e participantes A, B, C. O pede o sorteio da rodada 1 e `simularWorker` grava A→B, B→C, C→O, O→A. Asserções:
  1. A consulta todos os `pares` → só o próprio (receptor B).
  2. O consulta `pares` → só o próprio (O→A), **nunca** os outros 3.
  3. A tenta criar um `par` ou mudar `sorteios.status` → `permission-denied`.
  4. A vê as respostas de B, e não vê as de C nem as de O.
  5. O vê as respostas de A (que ele tirou), e não vê as de B nem as de C.
  6. O pede o sorteio da rodada 1 de novo → `record-not-unique`.
  7. Pedir a rodada 4 → `permission-denied`.
  8. Um participante (não organizador) pedir sorteio → `permission-denied`.
  9. A grava `viuParNaRodada: 1` no próprio participante → ok. Grava no de B → `permission-denied`.
  10. A tenta sair (`delete` do próprio participante) com o grupo `sorteado` → `permission-denied`. O remove A → ok.
  11. A mesma query de (1) feita pelo **SDK cliente** (`@instantdb/core`, logado com o token de A via `db.auth.signInWithToken`) dá o mesmo resultado. Isso equivale às "queries manuais pelo console".
- [ ] **Step 2: Escrever `permissoes.conta.test.ts`.**
  1. O usuário apaga o próprio `$users` → ok. Apagar o de outro → `permission-denied`.
  2. Apagar um grupo como organizador → campos, participantes, respostas, sorteios e pares do grupo somem (consulta como admin).
  3. Rodar `/admin` `query_perms_check` (ou o equivalente do admin SDK, se existir na 1.0.67) para "A vê pares" bate com o esperado. Se o SDK não expuser isso, registre em §10 e pule com `test.skip` mais o comentário do achado.
- [ ] **Step 3: Aplicar no app de teste e rodar.** Run: `infra/instant-push.sh teste && bun test testes/`. Expected: PASS.
- [ ] **Step 4: Aplicar em produção.** Run: `infra/instant-push.sh prod`.
- [ ] **Step 5: Commit.** `git commit -m "feat(instant): regras de sorteio, pares e conta"`

---

### Task 7: `worker/nucleo`: campainha genérica Instant → OpenWorkflow

**Files:** Create `worker/package.json`, `worker/nucleo/campainha.ts`, `worker/nucleo/log.ts`, `worker/nucleo/campainha.test.ts`

**Interfaces:**
- Produces:
  - `log(evento: string, dados?: Record<string, string | number | boolean>)`: uma linha JSON com `ts`, `evento` e os dados. Ids e contagens apenas, por contrato.
  - Assinatura e watchdog:

    ```ts
    type Assinatura<T> = (aoReceber: (itens: T[]) => void, aoErro: (e: unknown) => void) => { fechar(): void };
    function iniciarCampainha<T>(opts: {
      nome: string;                       // p/ logs
      assinar: Assinatura<T>;             // em produção: wrapper de db.subscribeQuery
      chave: (item: T) => string;         // idempotencyKey
      disparar: (item: T, chave: string) => Promise<void>; // em produção: ow.runWorkflow(...)
      backoffMs?: number[];               // padrão [1000, 2000, 5000, 10000, 30000]
    }): { parar(): void };
    ```

  - `assinaturaInstant(db, consulta)`: adapta `db.subscribeQuery(q, cb)` do admin 1.0.67 para `Assinatura`, chamando `aoErro` nos payloads de erro e no fechamento.

Comportamento: a cada entrega, `disparar` roda para cada item. Entregas repetidas do mesmo item são normais, porque a idempotência fica a cargo do `disparar`. Um erro em `disparar` é logado sem derrubar a campainha. Em `aoErro`, a campainha fecha a assinatura e reassina após o próximo valor do backoff, que zera na primeira entrega bem-sucedida.

- [ ] **Step 1: Escrever os testes com uma `Assinatura` falsa (controlável).**
  - Entregar `[a,b]` chama `disparar` 2 vezes com as chaves certas.
  - Um erro na assinatura faz fechar e reassinar após 1.000 ms (use fake timers ou `backoffMs: [10,20]`). Um segundo erro reassina após 20 ms. Itens entregues após a reconexão são disparados (**Review Focus 5**).
  - Um `disparar` que rejeita não impede o próximo item.
  - `parar()` fecha a assinatura e não reassina mais.
  - Nenhuma linha de `log` contém valores de campos dos itens além da chave.
- [ ] **Step 2: Rodar e ver falhar**, depois **implementar**, depois **rodar e ver passar.** Run: `bun test worker/nucleo`.
- [ ] **Step 3: Commit.** `git commit -m "feat(worker): núcleo da campainha com reconexão"`

---

### Task 8: Workflow `sortear` e `worker/main.ts`

**Files:** Create `worker/workflows/sortear.ts`, `worker/workflows/sortear.test.ts`, `worker/main.ts`

**Interfaces:**
- Consumes:
  - `sortear`, `ErroSorteio` e `Par` de `@amigo/dominio`;
  - `iniciarCampainha`, `assinaturaInstant` e `log` (Task 7);
  - os helpers de teste (Task 5).
- Produces:
  - `definirSorteio(ow: OpenWorkflow, db: AdminDb)`: registra o workflow `"sortear"` (versão `"1"`), com input `{ sorteioId: string }` e output `{ pares: number } | { erro: string }`.
  - `processarPendentes(ow, db)`: inicia a campainha sobre `{ sorteios: { $: { where: { status: { $in: ["pendente","processando"] } } } } }` e dispara `wf.run({ sorteioId }, { idempotencyKey: sorteioId })`.
  - `worker/main.ts`, com variáveis de ambiente `INSTANT_APP_ID`, `INSTANT_ADMIN_TOKEN`, `INSTANT_API_URI`, `OW_DB` (padrão `/data/ow.db`) e `OW_CONCORRENCIA` (padrão `2`). Ele:
    1. abre o `BackendSqlite.connect(OW_DB)`;
    2. sobe o worker do OpenWorkflow;
    3. inicia `processarPendentes`;
    4. no SIGTERM/SIGINT, para a campainha, chama `worker.stop()` e sai com 0.

**Passos do workflow:** cada `step.run` devolve só ids e contagens.
1. `carregar`: lê o sorteio com o grupo, os participantes (não removidos), as restrições e os pares existentes do grupo.
   - Sorteio inexistente, ou com status `concluido`/`erro`, termina o workflow com `{ pares: 0 }` sem efeitos.
   - `rodada !== grupo.rodadaAtual + 1` marca `erro: "Rodada inválida"`.
   - Devolve `{ grupoId, rodada, participantes: string[], restricoes: Restricao[], paresAntigos: string[] }`.
2. `marcar-processando`: `sorteios.status = "processando"`.
3. `sortear`: `sortear(participantes, restricoes, seedDe(sorteioId))`. Em `ErroSorteio`, grava `status: "erro"` e `erro: e.message` e termina **sem retry** (devolve `{erro}`, não lança). Outros erros lançam, e o OpenWorkflow refaz o passo (10 tentativas).
4. `gravar-pares`: numa única `transact`:
   - apaga os `paresAntigos`;
   - cria cada par com `lookup("chave", "<sorteioId>:<doador>")` (upsert);
   - linka sorteio, doador e receptor;
   - atualiza o grupo com `status: "sorteado"` e `rodadaAtual: rodada`;
   - atualiza o sorteio com `status: "concluido"` e `concluidoEm`.

**Logs:** `sorteio.iniciado`, `sorteio.concluido` (com `pares` e `duracaoMs`) e `sorteio.erro` (com `codigo`), sempre com `sorteioId`. Nada mais.

- [ ] **Step 1: Escrever os testes de integração** (app de teste, `OW_DB` num arquivo temporário, worker real do OpenWorkflow, concorrência 1).
  1. **Fluxo feliz:** grupo com 4 participantes, organizador cria o sorteio da rodada 1. Em até 15 s: status `concluido`, 4 pares, cada doador vê exatamente 1 par (via `asUser`), grupo `sorteado` com `rodadaAtual: 1`.
  2. **Dois `run` com o mesmo `sorteioId`:** um único run no OpenWorkflow (`workflow_runs` com 1 linha para a chave).
  3. **Idempotência sem o OpenWorkflow:** apagar o arquivo `OW_DB`, criar um backend novo e rodar o mesmo `sorteioId` já concluído. Nenhuma mudança, os pares continuam os mesmos ids.
  4. **Restrições impossíveis:** status `erro` com a mensagem `"As restrições tornam o sorteio impossível"`, `attempts == 1` e o grupo continua `aberto`.
  5. **Refazer:** após o caso 1, marcar um participante como `removido` e pedir a rodada 2. Pares da rodada 1 apagados, 3 pares novos, `rodadaAtual: 2`.
  6. **Restrição citando participante removido** é ignorada e o sorteio conclui (**Review Focus 2**).
  7. **Grupo com 2 participantes ativos:** `erro` com `"São necessários pelo menos 3 participantes"`.
  8. **Re-execução de `gravar-pares`:** executar o passo duas vezes, chamando a função interna exportada `gravarPares` duas vezes. Os mesmos 4 pares, nenhum duplicado.
- [ ] **Step 2: Rodar e ver falhar**, **implementar**, **rodar e ver passar.** Run: `bun test worker/`. Expected: PASS.
- [ ] **Step 3: Teste manual local.** Com o `.env` apontando o worker para o app de teste, `bun worker/main.ts` processa um sorteio criado por script. Mate com `kill -9` no meio, suba de novo, e o sorteio conclui em até 45 s (lease de 30 s). Anote os tempos em §10.
- [ ] **Step 4: Commit.** `git commit -m "feat(worker): workflow de sorteio e processo principal"`

---

### Task 9: Infra Dokku: `amigo-worker`, `amigo-painel`, `bin/painel` e e2e em produção

**Files:** Create `worker/Dockerfile`, `worker/Procfile`, `painel/package.json`, `painel/openworkflow.config.ts`, `painel/Dockerfile`, `infra/provisionar.sh`, `infra/deploy.sh`, `bin/painel`, `testes/e2e-producao.ts`

**Decisões fixas:**
- **Build:** os Dockerfiles usam o **repositório inteiro** como contexto: `dokku builder:set <app> selected dockerfile`, mais `builder-dockerfile:set <app> dockerfile-path worker/Dockerfile` (idem para `painel/`). Base `oven/bun:1.4.5@sha256:<digest>`; obtenha o digest com `docker buildx imagetools inspect oven/bun:1.4.5` ou pela API do Docker Hub.
- **`amigo-worker`:**
  - Procfile `worker: bun worker/main.ts`, com `ps:scale amigo-worker web=0 worker=1`;
  - `proxy:disable`;
  - volume `/var/lib/dokku/data/storage/amigo-workflows` montado em `/data`;
  - `ps:set amigo-worker stop-timeout-seconds 30`;
  - `config:set` com as variáveis do Instant de **produção** e `DO_NOT_TRACK=1`.
- **`amigo-painel`:**
  - roda `@openworkflow/dashboard@0.1.12` com Bun (`CMD` chamando o binário do pacote com `bun --bun`), `PORT=3999`, `DO_NOT_TRACK=1`;
  - `openworkflow.config.ts` aponta para `/data/ow.db`;
  - mesmo volume;
  - `proxy:disable`;
  - `docker-options:add amigo-painel deploy "-p 127.0.0.1:3999:3999"`;
  - checks de zero-downtime desligados se a porta conflitar.
- **`infra/deploy.sh <app>`:** `git push dokku@vps-mercurio:<app> HEAD:main --force` (a branch remota `main` de cada app Dokku é só o alvo de deploy).
- **`bin/painel`:**
  - `ssh -N -L 3999:127.0.0.1:3999 vps-mercurio`, com o PID guardado;
  - abre `http://localhost:3999` (`xdg-open`, `wslview` ou só imprime a URL);
  - encerra o túnel com Ctrl+C.

**Interfaces:**
- Produces: `testes/e2e-producao.ts`, executável com `bun testes/e2e-producao.ts`, sai com 0 se tudo passar. Contra o app de **produção**, com prefixo `e2e-<timestamp>`:
  1. cria organizador e 3 participantes;
  2. o grupo entra por código;
  3. o organizador pede o sorteio;
  4. espera `concluido` por até 60 s (servido pelo `amigo-worker` em produção);
  5. confere que cada um vê exatamente 1 par;
  6. apaga tudo.

- [ ] **Step 1: Escrever `infra/provisionar.sh`, idempotente.** Cada comando checa antes de criar (`dokku apps:exists`, `storage:list`, `docker-options:report`). Run: `infra/provisionar.sh`. Expected: na segunda execução, nenhuma mudança.
- [ ] **Step 2: Deployar o worker.** Run: `infra/deploy.sh amigo-worker && ssh vps-mercurio 'dokku ps:report amigo-worker | grep -i running; dokku logs amigo-worker --num 20'`. Expected: `running`, log `worker.iniciado`, sem stack traces.
- [ ] **Step 3: Deployar o painel.** Run: `infra/deploy.sh amigo-painel`. Depois:
  - `ssh vps-mercurio 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3999/'` → `200`;
  - `curl -m 5 http://<ip-da-vps>:3999/` da máquina local → falha de conexão.
- [ ] **Step 4: Testar o e2e e o túnel.** Run: `bun testes/e2e-producao.ts`. Expected: exit 0. Depois, `bin/painel` em background, `curl -s localhost:3999 | grep -c sortear` ≥ 1 (o run do e2e aparece) e encerrar o túnel.
- [ ] **Step 5: Testar a resiliência.**
  - `ssh vps-mercurio 'dokku ps:restart amigo-worker'` durante um e2e: conclui.
  - Medir a RAM com `docker stats --no-stream` dos dois containers e anotar em §10.
- [ ] **Step 6: Commit.** `git commit -m "feat(infra): worker e painel no Dokku, túnel e e2e de produção"`

---

### Task 10: Front: base SPA, tema, login, intenção, layout, Meus grupos e deploy

**Files:** Create `app/` (SvelteKit), `app/src/lib/instant.ts`, `app/src/lib/intencao.ts`, `app/src/lib/intencao.test.ts`, `app/src/routes/+layout.ts` (`export const ssr = false; export const prerender = false`), `app/src/routes/+layout.svelte`, `app/src/routes/+page.svelte` (landing), `app/src/routes/entrar/+page.svelte` (login), `app/src/routes/grupos/+page.svelte`, `app/src/routes/privacidade/+page.svelte`, `app/src/routes/termos/+page.svelte`, `infra/pages.sh`, `infra/instant-origens.sh`

**Decisões fixas:**
- **Base:** `bunx --bun sv create app` (template mínimo, TypeScript), `adapter-static` com `fallback: "index.html"`, Tailwind 4, e o setup do neobrutalism-svelte conforme a página de instalação do registry (tema e fontes DM Sans / Geist Mono).
- **Componentes:** `bunx --bun shadcn-svelte@latest add https://neobrutalism-svelte.flenze.com/r/<c>.json` para `button card badge input textarea field label select checkbox radio-group dialog sheet sidebar tabs progress sonner skeleton empty separator dropdown-menu avatar tooltip`. Os componentes são commitados.
- **Cliente Instant:** `app/src/lib/instant.ts` exporta `db = init({ appId: PUBLIC_INSTANT_APP_ID, apiURI, websocketURI, schema })`, importando o schema da raiz (`../../../instant.schema`).
- **Login (`/entrar`):**
  - Se `PUBLIC_LOGIN_MAGIC === "on"`: formulário de e-mail, depois `db.auth.sendMagicCode`, depois campo de código e `db.auth.signInWithMagicCode`.
  - Se `PUBLIC_LOGIN_GOOGLE === "on"`: botão "Entrar com Google" com `db.auth.createAuthorizationURL({ clientName: "google", redirectURL: location.origin + "/entrar" })`.
  - Em produção, nesta fase: `PUBLIC_LOGIN_MAGIC=on`, `PUBLIC_LOGIN_GOOGLE=off`.
- **Intenção (`intencao.ts`, sem dependência do Svelte):**
  - `type Intencao = { tipo: "criar" } | { tipo: "entrar"; codigo?: string }`;
  - `guardarIntencao(i, storage = sessionStorage)` e `consumirIntencao(storage = sessionStorage): Intencao | null`, este de uso único;
  - `destinoAposLogin(i: Intencao | null): string`: `criar` vai para `/criar`, `entrar` com código vai para `/g/<codigo>`, `entrar` sem código vai para `/entrar-grupo`, e `null` vai para `/grupos`.
- **Landing (`/`):** uma frase e dois botões, "Criar um grupo" e "Entrar em um grupo". Cada botão guarda a intenção e vai para `/entrar`, ou direto ao destino se já houver login. Usuário logado é redirecionado para `/grupos`.
- **Layout interno:** `sidebar` (drawer `sheet` no celular) com:
  - "Organizando" e "Participando": grupos onde `organizador.id == auth.id`, e grupos onde há participação não removida e o usuário não é o organizador;
  - um selo de status em cada grupo (`aberto`, `sorteado`, `encerrado`);
  - atalhos "Criar grupo" e "Entrar em grupo";
  - menu da conta com "Minha conta" e "Sair".
- **`/grupos`:** as mesmas duas seções em cards, com estado vazio (`empty`) nos dois casos.
- **`/privacidade` e `/termos`:** textos curtos e verdadeiros:
  - dados guardados: e-mail, respostas de perfil, participações;
  - onde ficam: servidor no Brasil;
  - quem vê: as regras do app;
  - como apagar: em "Minha conta";
  - contato: e-mail do Thomaz;
  - sem anúncios e sem compartilhamento com terceiros.
- **`infra/instant-origens.sh`:** cadastra pela API, com o admin token de produção, as origens `amigo.tpou.gy`, `amigo-secreto.pages.dev` e `localhost:5173` (`POST /dash/apps/<id>/authorized_redirect_origins`; payload conforme `crates/instant-server/src/routes/dash_apps.rs` no commit fixado). É idempotente: lê antes com `GET /dash/apps/<id>/auth`.
- **`infra/pages.sh`:**
  1. `cd app && bun --bun vite build`;
  2. `bunx --bun wrangler@4 pages project create amigo-secreto --production-branch main` se ainda não existir;
  3. `bunx --bun wrangler@4 pages deploy build --project-name amigo-secreto --branch main`;
  4. adiciona o domínio próprio `amigo.tpou.gy` pela API do Cloudflare (`POST /accounts/<account_id>/pages/projects/amigo-secreto/domains`) usando o token OAuth do wrangler (`~/.config/.wrangler/config/default.toml`), se o domínio ainda não estiver na lista.
- **Se o domínio próprio não ativar** (DNS sem permissão de escrita no token): registre em §10, use `amigo-secreto.pages.dev` e ponha no handoff final o CNAME `amigo` → `amigo-secreto.pages.dev` para o Thomaz criar.

- [ ] **Step 1: Testes de `intencao.ts`.** `bun test app/src/lib/intencao.test.ts`, com um `storage` em memória. Asserções:
  - guardar e depois consumir devolve a intenção; um segundo consumo devolve `null`;
  - `destinoAposLogin` cobre os 4 casos acima.
- [ ] **Step 2: Rodar e ver falhar**, **implementar**, **ver passar.**
- [ ] **Step 3: Montar o app.** Fazer scaffold, tema, componentes, rotas acima e login.
  - Run: `cd app && bun --bun svelte-kit sync && bun --bun svelte-check`. Expected: 0 erros.
  - Run: `bun --bun vite build`. Expected: `build/index.html` gerado.
- [ ] **Step 4: Teste local contra produção.**
  1. `bun --bun vite dev`;
  2. pedir o magic code para `thomazpougy@gmail.com` via UI, ou chamar `db.auth.sendMagicCode` por script;
  3. ler o código em `ssh vps-mercurio 'dokku logs instant --num 50' | grep -i -A2 thomazpougy` ou em `/admin/magic_code`;
  4. logar.

  Expected: `/grupos` vazio, sem erro no console. Registre em §10 se o `@instantdb/svelte` teve qualquer surpresa (é a pergunta 1 do piloto).
- [ ] **Step 5: Deploy.** Run: `infra/instant-origens.sh && infra/pages.sh`. Expected: `curl -s https://amigo-secreto.pages.dev/g/ABC-123 | grep -c '<div'` ≥ 1 (o fallback do SPA funciona), e o mesmo em `https://amigo.tpou.gy` se o domínio ativou.
- [ ] **Step 6: Commit.** `git commit -m "feat(app): base SPA, login, layout e deploy no Pages"`

---

### Task 11: Front: criar grupo (onboarding em 6 etapas) e compartilhar

**Files:** Create `app/src/routes/criar/+page.svelte`, `app/src/lib/criar/estado.svelte.ts`, `app/src/lib/criar/estado.test.ts`, `app/src/lib/components/EditorCampos.svelte`, `app/src/lib/components/Stepper.svelte`, `app/src/lib/components/Compartilhar.svelte`

**Decisões fixas:**
- **Etapas** exatamente como no `ideias.md` §3.3: Tema → Sobre → Datas e regras → Campos → Revisão → Compartilhar.
  - O `Stepper` é feito com `progress` + `card`.
  - "Voltar" preserva o estado.
  - Trocar de tema depois de editar campos pede confirmação: "Trocar o tema substitui os campos".
- **`EditorCampos`:** adicionar, remover, reordenar (botões ↑/↓; arrastar é opcional), editar rótulo, ajuda, tipo e opções (para `multipla`/`unica`) e marcar obrigatório.
- **Validação por etapa:**
  - título com 3 a 80 caracteres;
  - descrição com até 500;
  - datas opcionais, mas a do evento não pode ser anterior à prevista para o sorteio;
  - valor ≥ 0;
  - cada campo com rótulo;
  - `multipla`/`unica` com pelo menos 2 opções.
- **Confirmar:** gera o código (`gerarCodigo`) e roda uma transação única que cria o `grupo` (`status: "aberto"`, `rodadaAtual: 0`), linka o organizador, cria os `campos` e cria o participante do organizador (apelido = parte do e-mail antes do `@`, editável depois).
  - Em `record-not-unique` no `codigo`, gera outro e tenta de novo, até 5 vezes.
  - Ao terminar, vai para a etapa Compartilhar.
- **`Compartilhar`:**
  - código formatado (`formatarCodigo`) em fonte grande;
  - QR do link `https://<origem>/g/<CODIGO>` (biblioteca `qrcode`, gerando um SVG);
  - botões "Copiar link" e "Compartilhar" (`navigator.share` quando existir);
  - botão "Ir para o grupo".
- **Lógica de estado** em `estado.svelte.ts` com funções puras testáveis:
  - `validarEtapa(n, estado)`;
  - `trocarTema(estado, temaId)`;
  - `paraTransacao(estado, ids)`, que devolve a lista de operações a fazer.

- [ ] **Step 1: Escrever os testes de `estado.test.ts`.**
  - `validarEtapa` recusa um título de 2 caracteres e o evento antes do sorteio.
  - `trocarTema("livro")` preenche os 4 campos.
  - `paraTransacao` cria exatamente 1 grupo, N campos com `ordem` 0..N-1 e 1 participante do organizador.
- [ ] **Step 2: Ver falhar**, **implementar o estado**, **ver passar.**
- [ ] **Step 3: Implementar as telas.** Run: `bun --bun svelte-check` (0 erros) e `bun --bun vite build`.
- [ ] **Step 4: Teste local contra produção.** Criar um grupo do tema Livro. Em seguida:
  - o grupo aparece em "Organizando" na sidebar;
  - o QR, quando decodificado com `zbarimg` ou com a biblioteca de leitura da Task 12, aponta para `/g/<CODIGO>`;
  - criar 1.000 grupos por script em `testes/` (como admin, no app de teste, com o mesmo `gerarCodigo` e a mesma retentativa) não deixa nenhuma colisão sem tratamento (`ideias.md` §7.3).
- [ ] **Step 5: Commit.** `git commit -m "feat(app): criar grupo em etapas e compartilhar"`

---

### Task 12: Front: entrar no grupo (código, QR, link), prévia e perfil

**Files:** Create `app/src/lib/navegacao.ts`, `app/src/lib/navegacao.test.ts`, `app/src/routes/entrar-grupo/+page.svelte`, `app/src/routes/g/[codigo]/+page.svelte`, `app/src/routes/grupos/[id]/perfil/+page.svelte`, `app/src/lib/components/FormularioPerfil.svelte`, `app/src/lib/components/LeitorQR.svelte`

**Decisões fixas:**
- **`/entrar-grupo`:** campo de código (aceita qualquer formato; `normalizarCodigo` no envio, e `null` mostra "Código inválido" sem consultar o Instant) e botão "Escanear QR".
  - O `LeitorQR` usa `BarcodeDetector` quando existe e `jsQR` como fallback, lendo a câmera via `getUserMedia`.
  - Aceita um QR com a URL `/g/<CODIGO>` ou só com o código.
- **`/g/[codigo]`:** sem login, guarda `{tipo:"entrar", codigo}` e vai para `/entrar`. Com login, consulta o grupo com `ruleParams: { codigo }` (incluindo campos, contagem de participantes, organizador e o vínculo do próprio usuário). Mostra:
  - prévia: título, descrição, tema, datas, número de participantes;
  - botão "Entrar no grupo".

  A transação de entrada cria o participante com `chave: "<grupoId>:<userId>"`, `apelido` (pedido num campo antes de confirmar, já preenchido com a parte do e-mail), `perfilCompleto: false`, `removido: false` e `ruleParams: { codigo }`. Depois vai para `/grupos/<id>/perfil`.
- **`navegacao.ts`:** `destinoAoAbrirCodigo(e: { logado: boolean; grupo: null | { id: string; status: string }; souMembro: boolean }): { tipo: "login" } | { tipo: "nao-encontrado" } | { tipo: "ir-para-grupo"; id: string } | { tipo: "ja-sorteado" } | { tipo: "encerrado" } | { tipo: "previa" }`.
- **`FormularioPerfil`:** renderiza os `campos` do grupo, em ordem, pelo tipo:
  - `texto-curto` vira `input`;
  - `texto-longo` vira `textarea`;
  - `lista` vira itens com adicionar e remover;
  - `multipla` vira `checkbox`;
  - `unica` vira `radio-group`.

  Valida com `validarResposta`. Salva com upsert por `lookup("chave", "<participanteId>:<campoId>")`, recalcula `perfilCompleto` e o grava no participante.
- **Erros vindos do Instant:**
  - `rate-limited` vira "Muitas tentativas. Tente de novo em alguns minutos";
  - `record-not-unique` vira "Você já está neste grupo", e o app vai para o grupo;
  - `permission-denied` vira "Não foi possível entrar (o grupo pode estar fechado)".

- [ ] **Step 1: Escrever os testes de `navegacao.test.ts` (Review Focus 4).**
  - Não logado → `login`.
  - Grupo `null` → `nao-encontrado`.
  - Membro → `ir-para-grupo` (com qualquer status).
  - Não membro com `sorteado` → `ja-sorteado`.
  - Não membro com `encerrado` → `encerrado`.
  - Não membro com `aberto` → `previa`.
- [ ] **Step 2: Ver falhar**, **implementar**, **ver passar.**
- [ ] **Step 3: Implementar as telas.** `svelte-check` e build sem erros.
- [ ] **Step 4: Teste local com 2 contas magic code** (`thomazpougy@gmail.com` e `thomazpougy+p1@gmail.com`):
  1. a segunda conta abre `/g/<CODIGO>` deslogada, faz login, volta para a prévia, entra e preenche o perfil;
  2. o organizador vê o novo participante **ao vivo** na sidebar e na contagem, sem recarregar;
  3. digitar o código em minúsculas e com espaço funciona.
- [ ] **Step 5: Commit.** `git commit -m "feat(app): entrar por código, QR e link, prévia e perfil"`

---

### Task 13: Front: página do grupo (organizador e participante), sorteio e refazer

**Files:** Create `app/src/routes/grupos/[id]/+page.svelte`, `app/src/lib/grupo/consultas.ts`, `app/src/lib/grupo/regras.ts`, `app/src/lib/grupo/regras.test.ts`, `app/src/lib/components/Participantes.svelte`, `app/src/lib/components/PainelSorteio.svelte`, `app/src/lib/components/VoceTirou.svelte`, `app/src/lib/components/ConfiguracoesGrupo.svelte`, `app/src/lib/components/Restricoes.svelte`

**Decisões fixas:**
- **Visão do organizador:** `tabs` Participantes · Meu perfil · Sorteio · Configurações.
- **Visão do participante:** antes do sorteio, informações do grupo, lista de participantes, meu perfil e "Aguardando sorteio — previsto para <data>"; depois do sorteio, destaque `VoceTirou` no topo.
- **`VoceTirou`:** "Você tirou: <apelido>" mais as respostas do perfil dessa pessoa (de `respostas`, filtradas por `limparRespostas`). Ao montar com par visível, grava `viuParNaRodada = rodadaAtual` no próprio participante, se ainda não gravou.
- **`Participantes`:**
  - lista ao vivo com apelido, selo "perfil completo"/"incompleto" e selo "removido";
  - o organizador remove: antes do sorteio, `delete` direto com confirmação; depois do sorteio, a confirmação avisa "Remover depois do sorteio exige refazer o sorteio", marca `removido: true`, desliga `usuario` e apaga as respostas; em seguida a página abre o fluxo de refazer.
- **`Restricoes`:** o organizador escolhe dois participantes e um motivo opcional. Fica na aba Sorteio, antes do primeiro sorteio e entre rodadas.
- **`PainelSorteio`:**
  - antes da rodada 1: contagem de ativos, data prevista e botão **Sortear**, que fica desabilitado com menos de 3 ativos e mostra o motivo;
  - o botão cria o `sorteio` com `chave "<grupoId>:<rodadaAtual+1>"`, `rodada: rodadaAtual+1` e `status: "pendente"`;
  - o status aparece ao vivo (`pendente` → `processando` → `concluido`/`erro`);
  - em `erro`, mostra a mensagem e o botão "Tentar de novo", que cria a próxima rodada se ainda houver rodadas; se não houver, mostra "Limite de rodadas atingido";
  - depois de concluído: "Sorteio feito em <data> (rodada N de 3)" e **nunca** os pares;
  - ação "Refazer sorteio" conforme a regra abaixo.
- **Regra de refazer (`regras.ts`):** `confirmacaoRefazer(e: { rodadaAtual: number; ativos: number; viram: number; removidoAposSorteio: boolean }): { permitido: false; motivo: string } | { permitido: true; nivel: "simples" | "forte"; texto: string }`.
  - `rodadaAtual >= 3`: `permitido: false`, motivo "Limite de 3 sorteios atingido".
  - `ativos < 3`: `permitido: false`, motivo "São necessários pelo menos 3 participantes".
  - `viram == 0`: nível `simples`, texto "Refazer o sorteio? Ninguém viu o resultado ainda."
  - `viram > 0`: nível `forte`, texto "<viram> pessoa(s) já viram quem tiraram. Refazer troca os pares de todos." O diálogo exige digitar `REFAZER`.
  - `viram` = participantes não removidos com `viuParNaRodada == rodadaAtual`.
- **Banner** para o organizador quando existe participante `removido` com o grupo `sorteado`: "Um participante saiu depois do sorteio. Refaça o sorteio para incluir todos corretamente."
- **`ConfiguracoesGrupo`:**
  - editar título, descrição, datas e valor;
  - editar campos com o `EditorCampos`; remover um campo que tem respostas pede confirmação "As respostas deste campo serão apagadas", e as respostas caem por cascata;
  - ver código e QR (`Compartilhar`);
  - **Encerrar grupo** (`status: "encerrado"`);
  - **Apagar grupo**, que exige digitar o título.

- [ ] **Step 1: Escrever os testes de `regras.test.ts`.** Os 4 ramos de `confirmacaoRefazer` com os textos exatos acima, e `viram` calculado por `contarViram(participantes, rodadaAtual)` (removidos não contam).
- [ ] **Step 2: Ver falhar**, **implementar**, **ver passar.**
- [ ] **Step 3: Implementar as telas.** `svelte-check` e build sem erros.
- [ ] **Step 4: Teste local contra produção** (worker de produção) com 3 contas:
  1. sortear e ver os status ao vivo;
  2. cada conta vê "Você tirou" com um nome diferente;
  3. o organizador não vê pares na aba Sorteio;
  4. refazer com ninguém tendo visto pede confirmação simples;
  5. depois de uma conta abrir o par, pede confirmação forte com "1 pessoa(s)";
  6. a 4ª rodada fica bloqueada;
  7. remover alguém depois do sorteio mostra o banner.
- [ ] **Step 5: Deploy.** Run: `infra/pages.sh`.
- [ ] **Step 6: Commit.** `git commit -m "feat(app): página do grupo, sorteio e refazer"`

---

### Task 14: Front: capa, minha conta (exportar e apagar) e progresso por Stream

**Files:** Create `app/src/routes/conta/+page.svelte`, `app/src/lib/conta.ts`, `app/src/lib/conta.test.ts`, `app/src/lib/components/Capa.svelte`. Modify `worker/workflows/sortear.ts` (stream), `PainelSorteio.svelte`, `instant.perms.ts` (`$files`, `$streams`)

**Decisões fixas:**
- **Capa:**
  - o organizador envia uma imagem na aba Configurações;
  - compressão no navegador com canvas: lado maior de 1.600 px, JPEG com qualidade 0,8, mirando 300–500 KB;
  - `db.storage.uploadFile("grupos/<grupoId>/capa.jpg", file)` e link `grupos.capa`;
  - regras de `$files`: view para membros do grupo cujo `path` começa com `grupos/<id>/` (via `data.ref('grupoCapa.participantes.usuario.id')`, mais o organizador), create e delete só para o organizador (checar pelo prefixo do path em `data.path`);
  - mostrada no topo da página do grupo e nos cards.
- **Minha conta (`/conta`):**
  - **Exportar meus dados:** `montarExportacao(dados)` em `conta.ts` gera um JSON com o e-mail, as participações (grupo, apelido, respostas com o rótulo do campo) e os grupos organizados (título, código, campos). **Nunca** inclui pares de outras pessoas, apenas "quem eu tirei" por grupo. O download é feito via `Blob`.
  - **Apagar minha conta:** exige digitar `APAGAR`. Em ordem:
    1. para cada participação em grupo `sorteado`: `removido: true`, `apelido: "Participante removido"`, unlink de `usuario` e respostas apagadas;
    2. para cada participação em grupo `aberto`: `delete`;
    3. cada grupo que a pessoa organiza: `delete` (cascata);
    4. `delete` do próprio `$users`;
    5. `db.auth.signOut()` e ir para `/`.
  - **Sair do grupo** (participante, só antes do sorteio): botão em "Meu perfil", que dá `delete` no próprio participante. Depois do sorteio, o botão vira o texto "Para sair depois do sorteio, peça ao organizador".
- **Stream (bônus do `ideias.md` §7.6):**
  - o worker abre `db.streams` com `clientId: "sorteio-<sorteioId>"` e escreve `embaralhando`, `sorteando` e `pronto` (ou `erro`) entre os passos;
  - o `PainelSorteio` assina o stream e mostra a fase, com fallback para o `status`;
  - regras de `$streams`: view para membros do grupo do sorteio, e create só admin;
  - se a API de streams do admin 1.0.67 não suportar isso de forma limpa, registre em §10 e mantenha só o `status`.

- [ ] **Step 1: Escrever os testes de `conta.test.ts`.**
  - `montarExportacao` com 2 participações e 1 grupo organizado contém os rótulos dos campos.
  - Não contém nenhum id de participante que não seja o próprio ou o receptor do próprio par.
  - `planoApagarConta(dados)` devolve as operações na ordem acima, distinguindo grupos `aberto` e `sorteado`.
- [ ] **Step 2: Ver falhar**, **implementar**, **ver passar.**
- [ ] **Step 3: Estender `testes/permissoes.conta.test.ts`.**
  - A capa é visível para membro e invisível (`$files` vazio) para não-membro.
  - Apagar a conta de A depois do sorteio deixa o participante `removido` visível ao organizador e apaga as respostas de A.
  - Rodar `bun test testes/`. Expected: PASS.
- [ ] **Step 4: Rodar `instant-push.sh` (teste e prod)**, fazer **redeploy do worker e do Pages**, e testar manualmente: upload de uma foto de celular de cerca de 4 MB fica abaixo de 500 KB; export baixa um JSON; apagar uma conta de teste segue as regras.
- [ ] **Step 5: Commit.** `git commit -m "feat(app): capa, minha conta e progresso por stream"`

---

### Task 15: Seed idempotente (`ingestao/`)

**Files:** Create `ingestao/package.json`, `ingestao/seed.ts`, `ingestao/esquema.ts`, `ingestao/exemplo.json`, `ingestao/seed.test.ts`

**Interfaces:**
- Produces: `bun ingestao/seed.ts <arquivo.json> [--app teste|prod]`. O JSON segue o Zod `Seed`:

  ```
  { grupos: [{ codigo, titulo, tema, organizador: email,
               participantes: [{ email, apelido, respostas?: Record<rotulo,valor> }] }] }
  ```

  Comportamento:
  - grupo por `lookup("codigo", ...)`;
  - participantes por `lookup("chave", ...)`;
  - respostas por `lookup("chave", ...)`;
  - usuários criados com `db.auth.createToken(email)`;
  - campos criados uma vez, a partir do tema;
  - respostas validadas com `validarResposta`.

- [ ] **Step 1: Escrever os testes.**
  - Rodar o seed 2 vezes no app de teste deixa a mesma contagem de grupos, participantes e respostas.
  - Um JSON inválido (código com `0`, tema inexistente, e-mail inválido) é barrado pelo Zod antes de qualquer escrita, com uma mensagem que aponta o caminho do erro.
- [ ] **Step 2: Ver falhar**, **implementar**, **ver passar.** Run: `bun test ingestao/`.
- [ ] **Step 3: Escrever o `exemplo.json`** com um "Amigo livro (demo)" de 5 pessoas, e-mails `demo-*@teste.amigo`. **Não** rodar em produção.
- [ ] **Step 4: Commit.** `git commit -m "feat(ingestao): seed idempotente"`

---

### Task 16: MCP (`mcp/`)

**Files:** Create `mcp/package.json`, `mcp/ferramentas.ts`, `mcp/ferramentas.test.ts`, `mcp/servidor.ts`, `mcp/Dockerfile`, `mcp/Procfile`. Modify `infra/provisionar.sh`

**Decisões fixas:**
- **Servidor:** `fastmcp` 4.28.4 com `GoogleProvider`:
  - `baseUrl: "https://amigo-mcp.app.tpou.gy"`, `clientId`/`clientSecret` de `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`;
  - `scopes: ["openid","email","profile"]`;
  - `allowedRedirectUriPatterns`: `["https://claude.ai/*", "https://claude.com/*", "https://chatgpt.com/*", "http://localhost:*"]`;
  - `tokenStorage: new DiskStore({ directory: "/data/tokens" })` (o volume `amigo-mcp-data` é montado em `/data`);
  - `encryptionKey` e `jwtSigningKey` vindos de `MCP_ENCRYPTION_KEY`/`MCP_JWT_KEY`, gerados uma vez com `openssl rand -hex 32` e guardados só em `dokku config`, para que as sessões sobrevivam a redeploys;
  - transporte HTTP streamable na porta 8080.
- **Sem Google configurado** (`GOOGLE_CLIENT_ID=pendente`): o servidor sobe mesmo assim. A rota de saúde responde, e o OAuth falha com uma mensagem clara.
- **Ferramentas** (`ferramentas.ts`, funções puras sobre um `db` já impersonado):
  - `meusGrupos(db)` → `{ organizando: GrupoResumo[], participando: GrupoResumo[] }`
  - `meuAmigoSecreto(db, grupo: string /*id ou código*/)` → `{ apelido, respostas: { rotulo, valor }[] } | { aviso: "O sorteio ainda não aconteceu" }`
  - `meuPerfil(db, grupo)` → `{ campos: { rotulo, tipo, opcoes?, valor? }[] }`
  - `atualizarResposta(db, grupo, campoRotulo: string, valor: unknown)` → `{ ok: true } | { erro }`, que valida com `validarResposta` e recalcula `perfilCompleto`.
- **Em `servidor.ts`:** cada ferramenta pega o `email` da sessão Google (`GoogleSession.email`) e usa `admin.asUser({ email })`. Sem e-mail, devolve um erro de autenticação. As descrições das ferramentas ficam em português e dizem o que cada uma retorna.
- **Infra:**
  - app `amigo-mcp`, domínio `amigo-mcp.app.tpou.gy`, `letsencrypt:enable`;
  - porta `http:80:8080` e `https:443:8080`;
  - volume `amigo-mcp-data`.

- [ ] **Step 1: Escrever os testes de `ferramentas.test.ts`** (app de teste, grupo sorteado via `simularWorker`).
  - `meuAmigoSecreto` como A devolve só o receptor de A.
  - Ninguém consegue, por nenhuma ferramenta, obter o par de outra pessoa. Chamar `meuAmigoSecreto` como O devolve o par de O, não o de A.
  - `atualizarResposta` com uma opção inválida devolve `{erro: "Opção inválida"}`. Uma resposta válida grava como o próprio usuário (conferir pelo `asUser`).
  - `meusGrupos` separa organizando e participando.
  - Antes do sorteio, `meuAmigoSecreto` devolve o aviso.
- [ ] **Step 2: Ver falhar**, **implementar**, **ver passar.** Run: `bun test mcp/`.
- [ ] **Step 3: Provisionar e deployar.**
  - Run: `infra/provisionar.sh && infra/deploy.sh amigo-mcp`.
  - Expected: `curl -s -o /dev/null -w "%{http_code}" https://amigo-mcp.app.tpou.gy/health` (ou a rota de saúde do fastmcp) → `200`.
  - O endpoint MCP sem token → `401` com cabeçalho `WWW-Authenticate`.
  - Anote a RAM em §10.
- [ ] **Step 4: Commit.** `git commit -m "feat(mcp): servidor MCP com Google e ferramentas como usuário"`

---

### Task 17: Fechamento: verificação final, registro de achados e handoff

**Files:** Modify `discussion/ideias.md` (§10), `README.md`. Create `docs/handoff-google-oauth.md`

- [ ] **Step 1: Rodar a suíte inteira.**
  - Run: `bun test` na raiz. Expected: tudo PASS.
  - Run: `cd app && bun --bun svelte-check && bun --bun vite build`. Expected: 0 erros.
- [ ] **Step 2: Rodar a verificação em produção.**
  - Run: `bun testes/e2e-producao.ts` → exit 0.
  - `curl` da capa, do SPA fallback, do health do MCP e do `/health` do Instant.
  - `docker stats` de todos os `amigo-*` somados, abaixo de 250 MB (anotar).
  - `ssh vps-mercurio 'dokku logs amigo-worker --num 200'` não contém nenhum e-mail, apelido ou palavra de resposta usada nos testes (grep pelos valores conhecidos do e2e).
- [ ] **Step 3: Preencher `ideias.md` §10.** Uma linha por achado das Tasks 1–16, e responder às 9 perguntas do piloto ("Perguntas que o piloto deve responder") com "respondida / parcial / em aberto" mais uma frase. Itens que dependem do Google (perguntas 6 e 8) ficam "em aberto — depende do Google OAuth".
- [ ] **Step 4: Atualizar o `README.md`** com:
  - o que é o projeto;
  - a estrutura;
  - como rodar local (`bun install`, `.env`, `bun test`, `cd app && bun --bun vite dev`);
  - como deployar (`infra/*.sh`);
  - como ver o painel (`bin/painel`);
  - como logar por magic code enquanto o Google não está configurado.
- [ ] **Step 5: Escrever o `docs/handoff-google-oauth.md`**, com os passos exatos para o Thomaz:
  1. projeto no Google Cloud, tela de consentimento **publicada**, escopos `openid`/`email`/`profile`, links `https://amigo.tpou.gy/privacidade` e `/termos`;
  2. client OAuth **do app** com redirect `https://instant.tpou.gy/runtime/oauth/callback`, registrado com `ssh vps-mercurio 'instant-script create-oauth-client <app_id> google google <id> <secret> https://accounts.google.com/.well-known/openid-configuration amigo.tpou.gy'`;
  3. client OAuth **do MCP** com redirect `https://amigo-mcp.app.tpou.gy/oauth/callback`, configurado com `ssh vps-mercurio 'dokku config:set amigo-mcp GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=…'`;
  4. ligar o Google no front com `PUBLIC_LOGIN_GOOGLE=on` (e, se quiser, `PUBLIC_LOGIN_MAGIC=off`) e rodar `infra/pages.sh`;
  5. testes restantes: login Google no celular, MCP no claude.ai e no ChatGPT, sessão após 8 dias;
  6. se o domínio próprio não ativou na Task 10, o CNAME pendente.
- [ ] **Step 6: Revisão final da branch**, conforme a skill de execução. Depois o commit: `git commit -m "docs: achados do piloto, README e handoff do Google OAuth"`.
