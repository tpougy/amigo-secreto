# Perfis visíveis entre participantes — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o organizador ligue a opção `perfisVisiveis`, com a qual os membros veem as respostas uns dos outros num diálogo.

**Architecture:** Um atributo opcional em `grupos` e uma cláusula a mais em `respostas.view`, testados contra o app de teste. No front, um interruptor nas Configurações e um diálogo na lista de participantes. A exibição das respostas sai de `VoceTirou` para um componente comum.

**Tech Stack:** instantdb-rust (regras CEL), instant-cli 1.0.67, SvelteKit e Svelte 5, Bun 1.4.5.

**Spec:** `docs/superpowers/specs/2026-11-23-perfis-visiveis-design.md`

## Global Constraints
- O atributo é `perfisVisiveis: i.boolean().optional()` em `grupos`. Ausente equivale a falso.
- Regra: `respostas.view = "ehDono || tirouODono || ((ehMembro || ehOrganizador) && perfisVisiveis)"`.
- Texto do interruptor: "Participantes podem ver o perfil uns dos outros". Texto sem respostas: "Ainda não preencheu o perfil."
- Push de schema e regras: primeiro `infra/instant/instant-push.sh teste`. Se aparecer qualquer remoção, PARE. Depois `prod`. Só pode haver adição.
- Nunca ler nem imprimir `.env` ou segredos.
- Commits em pt-BR, com as linhas de atribuição da sessão.

## Review Focus
1. **Removido depois do sorteio continua vendo:** o membro desligado do usuário não pode ver. Teste na Task 1.
2. **Flag desligada depois de ligada:** a leitura volta a ser negada. Teste na Task 1.
3. **Estranho com o código certo (`ruleParams`):** não vê respostas, mesmo com a flag ligada. Teste na Task 1.
4. **Membro de outro grupo com a flag ligada:** não vê as respostas de G. Teste na Task 1.
5. **Diálogo aberto quando o organizador desliga a flag:** a consulta ao vivo esvazia e mostra o texto de "sem respostas", sem erro.

---

### Task 1: Schema, regra e testes de permissão

**Files:**
- Modify: `pacotes/instant/schema.ts` (grupos)
- Modify: `pacotes/instant/perms.ts` (respostas.bind e view)
- Create: `pacotes/instant/testes/permissoes.perfis.test.ts`

**Interfaces (produz):** `grupos.perfisVisiveis?: boolean`.

- [ ] **Step 1:** escrever os testes. O setup segue `permissoes.grupos.test.ts`: org, a, b, estranho e membroH; grupos G e H; `b` grava uma resposta em G. Os testes:
  - `flag ausente: membro não vê respostas de outro`: `a` consulta `participantes[pB].respostas` e recebe `[]`.
  - `flag ligada: membro e organizador veem`: org faz `grupos[G].update({perfisVisiveis: true})`. `a` e `org` recebem `[respostaB]`.
  - `flag ligada: estranho com o código e membro de outro grupo não veem`: `estranho` com `ruleParams {codigo}` e `membroH` recebem `respostas` `[]`.
  - `flag ligada: removido (removido + unlink do usuário) não vê`: org remove `a` e `a` recebe `[]`.
  - `flag desligada de novo: volta a não ver`: usar um novo participante `c`.
- [ ] **Step 2:** rodar `cd pacotes/instant && bun test testes/permissoes.perfis.test.ts`. Expected: falha, porque o atributo e a regra ainda não existem.
- [ ] **Step 3:** adicionar o atributo e os binds em `respostas`:
  - `ehMembro: "auth.id != null && auth.id in data.ref('participante.grupo.participantes.usuario.id')"`
  - `ehOrganizadorDoGrupo`: reaproveitar o `ehOrganizador` existente.
  - `perfisVisiveis: "true in data.ref('participante.grupo.perfisVisiveis')"`
  - e a nova `view`.
- [ ] **Step 4:** rodar `infra/instant/instant-push.sh teste`. Expected: só a adição de `grupos.perfisVisiveis` e a mudança da regra.
- [ ] **Step 5:** rodar de novo o teste do Step 2. Expected: PASS. Depois `bun run test` na raiz: tudo verde.
- [ ] **Step 6:** commit `feat(instant): perfis visíveis entre participantes (flag no grupo)`.

### Task 2: Front (interruptor, diálogo e componente de respostas)

**Files:**
- Create: `app/src/lib/components/RespostasPerfil.svelte` (props `{ respostas: { campo: DefCampo; valor: ValorResposta }[] }`, com o `<dl>` que hoje está em `VoceTirou`)
- Create: `app/src/lib/components/PerfilParticipante.svelte` (diálogo; props `{ aberto: boolean (bindable), participante: { id; apelido } | null, campos: DefCampo[] }`; consulta ao vivo `participantes: { $: { where: { id } }, respostas: { campo: {} } }` e `respostasVisiveis`)
- Modify: `VoceTirou.svelte` (passa a usar `RespostasPerfil`), `Participantes.svelte` (nova prop `perfisVisiveis: boolean` e `campos: DefCampo[]`; nomes ativos viram botão quando a prop for verdadeira), `ConfiguracoesGrupo.svelte` (`Grupo.perfisVisiveis?: boolean | null` e um checkbox que grava com `db.transact(grupos[id].update({perfisVisiveis}))`), `routes/(app)/grupos/[id]/+page.svelte` (passa as novas props nas duas listas).

- [ ] **Step 1:** implementar.
- [ ] **Step 2:** rodar `cd app && bun --bun svelte-check && bun --bun vite build && bun test`. Expected: 0 erros.
- [ ] **Step 3:** testar no navegador local contra o app de teste, se for viável; senão no e2e de produção depois do deploy:
  - liga a flag → o nome vira botão → o diálogo mostra as respostas;
  - desliga a flag → a lista volta ao normal.
- [ ] **Step 4:** commit `feat(app): ver o perfil de outros participantes quando o organizador permitir`.

### Task 3: Produção
- [ ] **Step 1:** rodar `infra/instant/instant-push.sh prod`. Expected: só adição.
- [ ] **Step 2:** merge na `main` e push. O Workers Builds publica o front.
- [ ] **Step 3:** rodar `bun scripts/e2e-producao.ts`. Expected: exit 0.
