# Amigo Secreto — Produto e Plano de Testes para o Pluto

> O app de amigo secreto é um **piloto da stack do Pluto**: pequeno o bastante para ficar pronto rápido, mas com os mesmos problemas difíceis. Este documento define o produto (fluxos, telas, modelo de dados, permissões) e o que cada parte valida para o Pluto.
>
> Referências: `pluto-especificacao.md` e `instant-infra-etapa-zero.md`.
>
> Última atualização: 2026-11-20 (v2: grupos temáticos, campos de perfil configuráveis, entrada por código/QR, navegação).

---

## 1. Por que o amigo secreto é um bom piloto

O coração do amigo secreto é **segredo por usuário**: cada pessoa só pode ver quem ela tirou, e nem o organizador pode ver o sorteio. É a mesma garantia que o Pluto precisa para separar o plano de cada pessoa, e mais tarde os pacientes de cada Nutri.

O sorteio **não pode rodar no navegador** (quem rodasse veria tudo), então obriga a construir o padrão "worker no servidor reagindo a um pedido" que os agentes do Pluto vão usar.

E os **campos de perfil configuráveis por grupo** (seção 3.4) exercitam o mesmo problema da modelagem flexível do plano alimentar: estrutura definida em dados, não no código.

---

## 2. Visão do produto

Um app para organizar amigos secretos **temáticos**. Exemplo motivador: um **amigo livro**, em que cada participante conta quais livros leu recentemente e de que gêneros gosta, para evitar presente repetido ou fora do gosto.

Princípios:
- O organizador também é participante.
- Cada grupo define **o que os participantes informam** sobre si (campos de perfil), a partir de um tema.
- Ninguém vê quem os outros tiraram — nem o organizador.
- Uma pessoa pode organizar e participar de vários grupos ao mesmo tempo.

Domínio sugerido: `amigo.tpou.gy`.

---

## 3. Fluxos e telas

### 3.1 Mapa de navegação

```mermaid
flowchart TD
    L["Landing (pública)<br/>Criar grupo · Entrar em grupo"] -->|Criar| AUTH1["Login Google"]
    L -->|Entrar| AUTH2["Login Google"]
    LINK["Link /g/CODIGO<br/>(QR escaneado pela câmera)"] --> AUTH2
    AUTH1 --> ONB["Onboarding de criação<br/>(etapas)"]
    AUTH2 --> JOIN["Entrar em grupo<br/>código ou QR"]
    ONB --> ADM["Página do grupo<br/>visão organizador"]
    JOIN --> PREV["Prévia do grupo<br/>confirmar entrada"]
    PREV --> PERFIL["Preencher meu perfil<br/>(campos do grupo)"]
    PERFIL --> PART["Página do grupo<br/>visão participante"]
    ADM -.-> HOME["Meus grupos<br/>(menu lateral)"]
    PART -.-> HOME
```

### 3.2 Landing (pública)

- Explica o app em uma frase e mostra **dois botões**: **Criar um grupo** e **Entrar em um grupo**.
- Ambos exigem login com Google; a landing em si não.
- **Preservar a intenção através do login:** antes de redirecionar para o Google, guardar a ação pretendida (criar / entrar com código X) em `sessionStorage`; ao voltar, o app retoma de onde a pessoa estava. Sem isso, quem clicou em "entrar" cai numa tela genérica e se perde.
- Usuário já logado que abre a landing vai direto para **Meus grupos**.

### 3.3 Criar grupo (onboarding em etapas)

| Etapa | Conteúdo |
|---|---|
| 1. Tema | Escolher um tema: **Livro**, **Livre**, **Vinho**, **Personalizado**… O tema é um *template*: pré-preenche os campos de perfil da etapa 4 |
| 2. Sobre o grupo | **Título** e **descrição** |
| 3. Datas e regras | **Data prevista do sorteio**, **data do evento**, valor sugerido (opcional) |
| 4. Campos do perfil | O que cada participante vai informar. Vem pré-preenchido pelo tema; o organizador adiciona, remove, reordena e marca como obrigatório |
| 5. Revisão | Resumo; confirmar cria o grupo |
| 6. Compartilhar | Mostra **código**, **QR Code** e **link**, com botão de compartilhar (Web Share API no celular) |

Depois disso, o organizador cai na página do grupo e é convidado a **preencher o próprio perfil** (ele também participa).

**Exemplo — tema Livro:**

| Campo | Tipo | Obrigatório |
|---|---|---|
| Livros que li recentemente | Lista de itens | Não |
| Gêneros que mais gosto | Múltipla escolha (fantasia, romance, suspense, não ficção, clássicos…) | Sim |
| Livros que já tenho / não quero ganhar | Lista de itens | Não |
| Observações para quem me tirar | Texto livre | Não |

Lista de desejos **não** faz parte do tema Livro (por decisão de produto: é específica demais). Ela pode existir como campo opcional em outros temas, se o organizador quiser.

### 3.4 Campos de perfil configuráveis

Tipos suportados na primeira versão:

| Tipo | Valor guardado |
|---|---|
| Texto curto | string |
| Texto longo | string |
| Lista de itens | array de strings |
| Múltipla escolha | array de opções definidas pelo organizador |
| Escolha única | uma opção |

- O organizador pode editar os campos depois de criado o grupo. Remover um campo com respostas pede confirmação; renomear não apaga respostas.
- As respostas de um participante são visíveis **só para ele e para quem o tirou** (depois do sorteio).

**Valor para o Pluto:** é o mesmo padrão de "estrutura definida em dados" que o plano alimentar flexível vai precisar (opções, porções e substituições variam por pessoa). Validar aqui como o Instant lida com valores JSON, validação e evolução desses campos.

### 3.5 Entrar em um grupo

Duas formas:
1. **Digitar o código** do grupo.
2. **Escanear o QR Code.**

Sobre o QR: o mais simples e robusto é o QR conter o **link** `https://amigo.tpou.gy/g/CODIGO`. Assim a pessoa escaneia com a **câmera do próprio celular**, sem abrir o app antes. O botão "Escanear QR" dentro do app continua útil (ex.: no desktop com webcam), usando a `BarcodeDetector` API onde existir, com uma biblioteca de fallback.

Fluxo após informar o código:
1. **Prévia:** título, descrição, tema, organizador, datas e número de participantes.
2. **Confirmar entrada.**
3. **Preencher meu perfil** com os campos do grupo.
4. Página do grupo (visão participante).

Regras: não é possível entrar depois do sorteio, nem duas vezes no mesmo grupo.

### 3.6 Código do grupo

Requisitos: fácil de ditar e digitar, difícil de adivinhar, único.

Proposta:
- **6 caracteres**, exibidos como `KQ7-M4P`.
- Alfabeto sem vogais e sem caracteres ambíguos: `BCDFGHJKMNPQRSTVWXZ23456789` (27 símbolos). Sem vogais, nenhum código forma palavra; sem `0/O`, `1/I/L`, ninguém confunde.
- Entrada tolerante: aceita minúsculas e ignora hífen e espaços.
- Gerado no cliente ao criar o grupo e gravado num atributo **único e indexado**. Se colidir, o servidor recusa com `record-not-unique` e o cliente gera outro.

Por que não 4 letras: com 4 caracteres há poucas centenas de milhares de combinações, e o código funciona como uma **chave de acesso**: quem adivinha, entra. Com 6 caracteres são centenas de milhões. Somado a um **rate limit** nas tentativas de entrada e ao fechamento do grupo após o sorteio, adivinhar deixa de ser viável.

### 3.7 Página do grupo — visão do organizador

Abas ou seções:

| Seção | Conteúdo |
|---|---|
| Participantes | Lista ao vivo de quem entrou e se já preencheu o perfil. Remover participante (antes do sorteio) |
| Meu perfil | O organizador preenche o próprio perfil |
| Sorteio | Contagem de participantes, data prevista, restrições opcionais (ex.: casais não se tiram), botão **Sortear**. Depois do sorteio: status e data — **sem mostrar os pares** |
| Configurações | Editar título, descrição, datas, campos; ver código/QR; encerrar grupo |

Ações pós-sorteio: **refazer sorteio** (com confirmação e limite), por exemplo se alguém precisou sair.

### 3.8 Página do grupo — visão do participante

| Antes do sorteio | Depois do sorteio |
|---|---|
| Informações do grupo, lista de participantes, meu perfil (editável), "aguardando sorteio" com a data prevista | Destaque: **"Você tirou: Fulano"**, com as respostas do perfil dele. Meu perfil continua editável |

### 3.9 Meus grupos e menu lateral

- Tela geral **Meus grupos**, com duas seções: **Organizando** e **Participando**. Um grupo que a pessoa organiza aparece em "Organizando" (ela participa dele também, mas não precisa aparecer duas vezes).
- **Menu lateral** presente em todas as páginas internas (drawer no celular), com a lista de grupos nas duas seções, atalhos para criar/entrar e o perfil da conta.
- Cada grupo mostra um selo de status: aberto, sorteado, encerrado.

---

## 4. Modelo de dados

| Entidade | Campos | Links |
|---|---|---|
| `$users` | email | → participacoes, → gruposOrganizados |
| `grupos` | titulo, descricao, tema, **codigo** (único, indexado), dataSorteioPrevista, dataEvento, valorSugerido, status (aberto / sorteado / encerrado) | → organizador (`$users`), → campos, → participantes, → sorteios, → capa (`$files`, opcional) |
| `campos` | rotulo, ajuda, tipo, opcoes (json), obrigatorio, ordem | → grupo |
| `participantes` | apelido, perfilCompleto | → usuario (`$users`), → grupo, → respostas |
| `respostas` | valor (json) | → participante, → campo |
| `restricoes` | motivo | → participanteA, → participanteB |
| `sorteios` | status (pendente / processando / concluido / erro), erro, criadoEm | → grupo, → `$streams` (opcional) |
| `pares` | — | → doador (participante), → receptor (participante), → sorteio |

Regras de modelagem:
- Um participante por usuário por grupo (unicidade validada na criação).
- Exclusão em cascata a partir de `grupos` e de `$users` (LGPD).
- Os temas não precisam ser entidade: são *templates* no código (`dominio/temas.ts`) que geram os `campos` iniciais.

---

## 5. Permissões

Este é o teste mais importante do piloto. Regras pretendidas:

| Entidade | Ler | Criar / alterar |
|---|---|---|
| `grupos` | Membros e organizador. **Não-membros só com o código certo** (para a prévia) | Organizador |
| `campos` | Membros | Organizador |
| `participantes` | Membros do mesmo grupo (nomes e se o perfil está completo) | Criar: o próprio usuário, com o código certo e grupo aberto. Remover: o próprio (antes do sorteio) ou o organizador |
| `respostas` | O dono e **quem tirou o dono** | O dono |
| `sorteios` | Membros (só o status) | Criar: organizador (com rate limit). Status: só o worker (admin) |
| `pares` | **Só o doador** | Só o worker (admin) |

### 5.1 O problema da prévia por código

Um não-membro precisa ver o grupo **se souber o código**, mas não pode **listar todos os grupos** para descobrir códigos. Uma regra de visualização comum ("qualquer autenticado vê") abriria a enumeração.

Solução: **`ruleParams`**. O cliente envia o código digitado como parâmetro da query, e a regra compara:

```ts
// instant.perms.ts (esboço)
grupos: {
  allow: {
    view: "auth.id in data.ref('participantes.usuario.id') || ruleParams.codigo == data.codigo",
  },
},
participantes: {
  allow: {
    create: "auth.id in data.ref('usuario.id') && ruleParams.codigo in data.ref('grupo.codigo') && 'aberto' in data.ref('grupo.status')",
  },
},
```

Sintaxe a validar contra o instantdb-rust, que implementa `ruleParams` segundo o `PARITY.md`. Se esse padrão funcionar, ele também serve no Pluto, por exemplo para um convite da Nutri a um paciente.

### 5.2 O organizador administra, mas não vê

O organizador cria o pedido de sorteio, mas a regra de `pares` só libera o par ao **doador**. E as `respostas` de cada pessoa só ficam visíveis para quem a tirou. O organizador vê as respostas de alguém somente se ele próprio tirou essa pessoa — como qualquer participante.

**Valor para o Pluto:** é exatamente o desenho "papel com poder administrativo, sem acesso a dado pessoal alheio" que a seção de LGPD recomenda.

---

## 6. Mapa: o que cada funcionalidade testa no Pluto

| Funcionalidade | Valida para o Pluto | Seção do Pluto |
|---|---|---|
| Landing pública + login Google preservando intenção | OAuth pelo Instant, origem autorizada, sessão que não expira, UX de login | 9 |
| Organizando × participando, menu lateral | Queries reativas com links em vários níveis; navegação do `@instantdb/svelte` | 13 |
| Campos de perfil configuráveis por tema | Modelagem flexível em dados, valores JSON, evolução de estrutura | 11 |
| Prévia por código com `ruleParams` | Acesso condicional sem enumeração (convites da Nutri no futuro) | 10 |
| Cada um vê só quem tirou; organizador não vê pares | Isolamento entre usuários; papel administrativo sem acesso a dado alheio | 10, 18 |
| Lista de participantes ao vivo | Reatividade | 13 |
| Botão "Sortear" → worker no servidor | `subscribeQuery` do admin + status pendente/processando/concluído | 15.3 |
| Sorteio com restrições como função pura | `dominio/` testável e reutilizável | 8 |
| Limites de sorteio e de tentativas de entrada | `rateLimit.*` nas regras | 10, 15.1 |
| Capa do grupo (opcional) | `$files`, upload do celular, URLs assinadas | 11, 13 |
| MCP com dicas de presente | `GoogleProvider` + `asUser` sem vazar segredo | 14 |
| Seed de grupos de teste | Seed idempotente com admin SDK | 12 |
| Sair do grupo / apagar conta | Cascata e exportação (LGPD) | 18.3 |
| Segundo app no mesmo servidor (quando o Pluto chegar) | Multi-app no instantdb-rust | infra |

---

## 7. Testes detalhados

Cada teste tem um **critério de sucesso** objetivo. Registre os resultados na seção 10.

### 7.1 Infraestrutura e multi-app

| Teste | Critério de sucesso |
|---|---|
| Provisionar o app com o script de criação | `app_id` e admin token gerados; guardados fora do git |
| `instant-cli push` de schema e permissões | Aplica sem erro; `pull` devolve o mesmo schema |
| Evoluir o schema com dados existentes (ex.: tornar `codigo` único depois de criado) | Indexing job conclui ou aponta os dados inválidos |
| Deploy do SPA em `amigo.tpou.gy` | HTTPS ativo; F5 em `/g/ABC-123` devolve o app (fallback) |
| Memória com o app em uso | Medir RSS do instant-server e do Postgres; anotar |
| `/metrics` de fora | 403 |

### 7.2 Autenticação e chegada

| Teste | Critério de sucesso |
|---|---|
| Clicar em "Entrar em um grupo" deslogado | Login Google e volta direto para a tela de código |
| Abrir `/g/CODIGO` deslogado (via QR) | Login e volta direto para a prévia daquele grupo |
| Fechar o navegador e voltar dias depois | Continua logado |
| Origem não cadastrada | Login recusado |

> ⚠️ Com o app do Google em **modo de teste**, cada participante precisa estar cadastrado como usuário de teste no Google Cloud Console, e há limite de usuários. Num amigo secreto com amigos de fora, isso é atrito real: anote se incomoda. Se incomodar, publicar o app do Google com escopos básicos normalmente não exige verificação — avaliar.

### 7.3 Código, QR e entrada

| Teste | Critério de sucesso |
|---|---|
| Criar 1.000 grupos via script | Nenhuma colisão não tratada; retentativa funciona |
| Digitar o código em minúsculas, com espaço ou sem hífen | Aceito |
| Escanear o QR com a câmera nativa (Android e iOS) | Abre a prévia do grupo |
| Escanear pelo botão do app no desktop | Lê o código |
| Entrar no mesmo grupo duas vezes | Recusado |
| Entrar após o sorteio | Recusado |
| Script tentando códigos aleatórios em sequência | Bloqueado pelo rate limit |

### 7.4 Permissões (o mais importante)

Escritos como **script automatizado** com `asUser({ email })` para cada participante. Esse script, adaptado, vira a suíte de regressão de permissões do Pluto.

| Teste | Critério de sucesso |
|---|---|
| Não-membro consulta grupos sem código | Nada |
| Não-membro consulta com código certo | Só aquele grupo |
| Não-membro consulta com código errado | Nada |
| Participante A consulta todos os `pares` | Apenas o próprio par |
| Organizador consulta os `pares` | Nada |
| Participante tenta criar/alterar `pares` ou o status do sorteio | `permission-denied` |
| A vê as respostas de quem tirou | Vê |
| A tenta ver as respostas de outra pessoa | Não vê |
| Organizador tenta ver respostas de quem ele não tirou | Não vê |
| Membro de outro grupo tenta ler o grupo | Nada |
| Queries manuais pelo console do navegador | Mesmos resultados (segurança no servidor) |
| `query_perms_check` do admin | Avaliação bate com o esperado |

### 7.5 Campos configuráveis

| Teste | Critério de sucesso |
|---|---|
| Criar grupo com tema Livro | Campos pré-preenchidos corretos |
| Adicionar, reordenar e remover campos | Refletido ao vivo para os participantes |
| Remover campo com respostas | Pede confirmação; respostas do campo somem |
| Campo obrigatório vazio | Perfil marcado como incompleto; organizador vê isso na lista |
| Valor fora do tipo (ex.: opção inexistente) | Rejeitado pela validação do domínio |

### 7.6 Worker do sorteio

1. Organizador clica em "Sortear" → cria `sorteio` com `status: "pendente"`.
2. Serviço `worker/` assina via `subscribeQuery` os pendentes.
3. Marca `processando`, roda `sortear()` de `dominio/`, grava `pares`, muda o grupo para `sorteado` e o sorteio para `concluido` (ou `erro`).

| Teste | Critério de sucesso |
|---|---|
| Sortear | Status ao vivo: pendente → processando → concluído |
| Reiniciar o worker com sorteio pendente | Processa ao voltar |
| Dois cliques rápidos | Só um sorteio |
| Erro forçado | `erro`, sem retry automático; botão "tentar de novo" |
| Restrições impossíveis | Erro claro, sem loop |
| Refazer sorteio | Pares antigos substituídos; limite respeitado |
| Redeploy do worker | Sobe sozinho; nada se perde |

**Bônus Streams (opcional):** o worker escreve "embaralhando… sorteando… pronto!" num Instant Stream. Bloquear o celular no meio e reabrir: a tela retoma o progresso ou mostra o resultado. Isso valida o transporte da v3 do Pluto.

### 7.7 Domínio isolado

`sortear(participantes, restricoes, seed?) → pares` como **função pura**, com testes unitários:
- ninguém tira a si mesmo;
- restrições respeitadas;
- todos dão e recebem exatamente uma vez;
- seed fixa gera resultado reprodutível.

Também em `dominio/`: geração e normalização do código, templates de temas, validação das respostas pelo tipo do campo.

### 7.8 Arquivos (opcional)

Capa do grupo enviada pelo organizador, com compressão no navegador. Critérios: upload rápido (300–500 KB), visível só para membros, sobrevive a redeploy do servidor Instant.

### 7.9 MCP

Servidor `fastmcp` (punkpeye) com `GoogleProvider` em `mcp.amigo.tpou.gy`. Ferramentas:
- `meus_grupos`
- `meu_amigo_secreto(grupo)` — quem eu tirei e as respostas do perfil dele
- `meu_perfil(grupo)` / `atualizar_resposta(grupo, campo, valor)`

Caso de uso: "Me sugere três livros para quem eu tirei no amigo livro." O Claude busca o perfil via MCP e sugere, evitando os já lidos. É a mesma lógica do "foto do cardápio" do Pluto.

| Teste | Critério de sucesso |
|---|---|
| Conectar no claude.ai (web) e no ChatGPT (modo desenvolvedor) | OAuth conclui; ferramentas chegam ao modelo nos dois |
| Usar no app do Claude no celular | Funciona sem recadastrar |
| Pedir "quem os outros tiraram?" | Só o próprio par (regras via `asUser`) |
| Atualizar uma resposta pelo Claude | Grava como o usuário certo |
| Sessão após **8 dias** | Continua funcionando |
| Redeploy do MCP | Sem atrito para reconectar |

### 7.10 Seed

Script que cria grupos e participantes de teste a partir de JSON local: rodar duas vezes não duplica (`lookup` por chave única); JSON inválido é barrado por Zod.

### 7.11 LGPD e ciclo de vida

| Teste | Critério de sucesso |
|---|---|
| Encerrar e apagar um grupo | Campos, participantes, respostas, sorteios e pares somem |
| Sair de um grupo (antes do sorteio) | Participação e respostas somem |
| Apagar minha conta | Some tudo do usuário; grupos dos outros continuam |
| Exportar meus dados | JSON com tudo do usuário |
| Logs do worker e do MCP | Sem conteúdo pessoal (pares, respostas), só metadados |

### 7.12 Operação

Restaurar backup do Postgres num banco temporário; atualizar o `IMAGE_TAG` do instantdb-rust pelo roteiro da etapa zero, com rollback testado; conferir a renovação do Let's Encrypt.

---

## 8. Estrutura sugerida do repositório

Espelha a do Pluto:

```
amigo-secreto/
├── app/                  # Svelte SPA + shadcn-svelte + @instantdb/svelte
├── instant.schema.ts
├── instant.perms.ts
├── dominio/              # sortear(), codigo, temas, validação de respostas + testes
├── worker/               # subscribeQuery → sorteio
├── mcp/                  # fastmcp + GoogleProvider
├── ingestao/             # seed de grupos de teste
├── testes/
│   └── permissoes.ts     # suíte asUser por participante
└── dados/                # .gitignore
```

---

## 9. O que este piloto **não** testa

- **Modelagem do plano alimentar:** porções, substituições e equivalências são mais complexas que campos de perfil.
- **Ingestão de PDFs com Claude Code:** o seed parte de JSON simples.
- **Agentes com chave própria e evals:** o sorteio não usa IA; o bônus de Streams cobre o transporte, não a qualidade.
- **Volume de dados:** poucos registros; performance com a TACO fica para o Pluto.
- **Papel de Nutri em escala:** o organizador cobre o conceito, não muitos pacientes.

---

## 10. Registro de achados

| Data | Área | O que aconteceu | Impacto no Pluto | Ação |
|---|---|---|---|---|
| 2026-11-20 | Permissões | `ruleParams.codigo == data.codigo` funciona no instantdb-rust: sem código, ou com código errado, a consulta de `grupos` volta `[]`; com o código certo e **sem** `where`, só aquele grupo aparece. Nenhum participante ou resposta vaza pela prévia | Padrão validado para convites por código (Nutri → paciente) | Coberto por `testes/permissoes.grupos.test.ts` (testes 1–5) |
| 2026-11-20 | Permissões | `rateLimit.entrada.limit(auth.id)` no início do `create` cobra o token **mesmo quando a regra nega** (20 `permission-denied` e a 21ª vira `rate-limited`), e o bloqueio vale também para um grupo aberto com o código certo | Rate limit em regra serve como freio a força bruta de códigos | Teste 11; manter o `rateLimit` como primeiro termo do `&&` |
| 2026-11-20 | Permissões | Regras explícitas de `link`/`unlink` por rótulo (com `actions.data == 'create'` e `linkedData`) bloqueiam mover participante/resposta para outro grupo e "virar organizador" via `$users.link`; a checagem roda nos dois lados do link | Dá para travar a troca de dono de um registro sem gambiarra | Testes de "movido para outro grupo" e "não vira organizador" |
| 2026-11-20 | Schema / CLI | `instant-cli pull` devolve um schema equivalente, mas troca `i.json()` por `i.any()` e inclui entidades/atributos de sistema (`$streams`, `$users.imageURL/type`, `linkedPrimaryUser`). As regras voltam idênticas | Nenhum; não usar o arquivo do `pull` como fonte da verdade | Fonte da verdade continua sendo `instant.schema.ts` do repo |
| 2026-11-20 | Monorepo (Bun) | Com instalação isolada do Bun, o `instant.schema.ts` na raiz não enxerga pacotes dos workspaces; foi preciso pôr `@instantdb/core` como devDependency da raiz | Mesmo arranjo no Pluto | `package.json` raiz com `@instantdb/core@1.0.67` |
| 2026-11-20 | Permissões / conta | O push recusa regra de `delete` em `$users` ("doesn't support permissions for delete", exige `"false"`) e o delete pelo cliente volta `validation-failed` ("$users is a system entity"). Só o admin (`auth.deleteUser`) apaga conta | "Apagar minha conta" precisa de endpoint no servidor (worker/MCP) também no Pluto | `$users.delete = "false"`; teste 1 de `permissoes.conta.test.ts` documenta; decidir onde fica o endpoint de exclusão |
| 2026-11-20 | Permissões / cascata | Apagar um registro checa a regra `delete` de **cada filho apagado em cascata**: com `sorteios`/`pares` em `delete: "false"`, o organizador não apagava mais o grupo depois do sorteio (`permission-denied`) | Toda entidade "só admin" pendurada num pai apagável pelo cliente precisa liberar `delete` para quem apaga o pai | `sorteios.delete`/`pares.delete` liberados ao organizador do grupo (não dá poder novo); teste 2 da conta |
| 2026-11-20 | Permissões / debug | `/admin/query_perms_check` (admin `debugQuery`) existe, mas nas `check-results` todo `data.ref(...)` sai `false` (até no registro que aparece em `result`); checagens só de atributos saem certas. Com `rules` override, o `result` continua filtrado pelas regras publicadas | `debugQuery` não serve para depurar regras com refs; confiar nos testes via `asUser` | Teste 3 (resultado) passa; 3b marcado `test.failing` até o servidor corrigir |
| 2026-11-20 | SDK cliente em Bun | `@instantdb/core` fora do navegador não faz nada (o Reactor sai cedo se não há `window`). Com `globalThis.window`, um Storage em memória e um NetworkListener "sempre online", `signInWithToken` + `queryOnce` funcionam no Bun e respeitam as regras | Testes de cliente e scripts no Pluto podem usar o core assim | Helper `paresComoCliente` em `permissoes.sorteio.test.ts` (teste 11) |
| 2026-11-20 | Permissões / unicidade | A unicidade de atributo é checada antes da regra: repetir a rodada 1 com `rodadaAtual` já 1 dá `record-not-unique`, não `permission-denied`. `string(int(data.rodada))` funciona no CEL para montar a chave `<grupoId>:<rodada>` | Nenhum; o tipo de erro só muda a mensagem da UI | Testes 6 e "chave forjada" |
| 2026-11-20 | Instant / upsert | `tx.x[lookup("chave", v)].update({ chave: v })` falha ("Updates with lookups can only update the lookup attribute if an entity with the unique attribute value already exists"); `update({})` com o lookup cria o registro (com a chave) ou reaproveita o existente | Upsert idempotente por chave única: usar `update({})` + `link` | `gravarPares` usa `update({})`; teste 8 do worker (reexecução = mesmos ids) |
| 2026-11-20 | Instant / transação | Apagar os pares da rodada anterior e criar os novos com os mesmos doadores/receptores (links one-to-one) na **mesma** `transact` funciona; não é preciso separar em duas transações como o `simularWorker` fazia | Troca atômica de vínculos one-to-one é viável | `gravar-pares` faz tudo numa transação; teste 5 do worker |
| 2026-11-20 | Instant / admin | `update({ erro: null })` limpa o atributo opcional, mas a consulta devolve `null` (não omite o campo) | Comparações com campo opcional devem tratar `null` e `undefined` | Testes usam `?? null` |
| 2026-11-20 | OpenWorkflow 0.11 | Quando um passo esgota as tentativas, o run falha com a política **padrão** do workflow (1 tentativa), ignorando o `retryPolicy` do workflow; `workflow_runs.attempts` soma 1 a cada claim (inclusive retries de passo e retomada por lease). Com `idempotencyKey` de 24 h, um run falho bloqueia novo run do mesmo `sorteioId` por 24 h e o sorteio fica `processando` | Erros definitivos devem ser tratados dentro do passo (marcar erro e retornar), nunca lançados | Passos com 10 tentativas (1 s → 60 s, ~5 min); ErroSorteio/rodada inválida tratados no passo. Pendente: varredura de runs `failed` para marcar `erro` no Instant |
| 2026-11-20 | Worker / tempos | Fluxo feliz: ~85–130 ms dentro do workflow, ~300 ms do `create` no cliente até `concluido`. `kill -9` dentro de `gravar-pares`: `bun worker/main.ts` novo concluiu 29 s após o kill (lease de 30 s), refazendo só o passo interrompido (`carregar` memorizado). SIGTERM ocioso: saída 0 em ~0,8 s | Assinar → enfileirar → passos memorizados serve para os agentes do Pluto | Registrado; lease padrão (30 s) mantido |
| 2026-11-20 | OpenWorkflow / retomada | Para não deixar sorteio preso em `processando` por 24 h após queda longa do Instant: passos com 300 tentativas (1 s → 60 s, ~5 h) e, se o run ainda assim falhar, `dispararSorteio` abre UM run novo com chave `<sorteioId>:retry:<idDoRunFalho>` (determinística, entregas repetidas caem no mesmo run). `rerunWorkflowRun` não serve: cria run sem chave, um por entrega. A reentrega após a falha vem da renovação de 10 min da campainha (o estado no Instant não muda) | Padrão "chave derivada do run falho" serve a qualquer workflow disparado por campainha no Pluto | Teste "run falho ganha UM run novo" no worker |
| 2026-11-20 | Dokku / portas | Com `proxy:disable`, o Dokku injeta `PORT` = porta do container no mapa detectado (`5000` num Dockerfile sem `EXPOSE`) **por cima** do `config:set PORT=3999`: o painel subiu ouvindo 5000 e o `-p 127.0.0.1:3999:3999` não respondia. Sem proxy o mapa não publica nada no host | Todo serviço Dokku sem Nginx do Pluto precisa fixar o mapa | `ports:set amigo-painel http:3999:3999` no `infra/provisionar.sh`; o `PORT` injetado vira 3999 |
| 2026-11-20 | Dokku / zero-downtime | Confirmado: com `docker-options -p 127.0.0.1:3999:3999` e checks ligados, o `ps:restart` falha (`Bind for 127.0.0.1:3999 failed: port is already allocated`), o antigo segue no ar e sobra um container `...upcoming-*` em `Created` | Porta fixa no host = sem zero-downtime (o `s3` da VPS já fazia igual) | `checks:disable amigo-painel` (deploy para o antigo antes de subir o novo, ~segundos fora do ar) |
| 2026-11-20 | Painel / imagem | `@openworkflow/dashboard@0.1.12` instala ~356 MB de `node_modules` (vite, tailwind, react...), mas o `.output` do Nitro já vem empacotado: em runtime só importa `@openworkflow/cli/internal` (que usa `jiti` para ler o config) e o config importa `openworkflow/sqlite`. Copiando só esse fecho (dashboard, cli, jiti, openworkflow, cron-parser, luxon) ficam ~11 MB. Roda com `bun --bun .../bin.mjs` sob Bun 1.4.5 e lista os runs do `/data/ow.db` | Imagens enxutas para a VPS de 2 GB | Multi-stage em `painel/Dockerfile` com `--linker hoisted` no estágio de build |
| 2026-11-20 | Bun / workspaces | Com o linker isolado do Bun e `bun install --production --filter`, as `devDependencies` da raiz não entram: `instant.schema.ts` (raiz) importa `@instantdb/core` e o worker quebrava no container | Código de runtime na raiz precisa de dependência de runtime na raiz | `@instantdb/core` passou de `devDependencies` para `dependencies` no `package.json` raiz; o build filtra `amigo-secreto` + `@amigo/worker` |
| 2026-11-20 | Infra / RAM | `docker stats --no-stream` em repouso: `amigo-worker` **~20 MiB**, `amigo-painel` **~59 MiB** (depois de servir páginas). Imagens: 383 MB e 366 MB, quase tudo a base `oven/bun:1.4.5` compartilhada. `available` da VPS foi de ~1178 para ~950 MB com os dois no ar | Cabe folgado; o painel pode até ficar parado (`ps:stop`) quando não estiver em uso | Medir de novo com uso real |
| 2026-11-20 | Worker / deploy | O `amigo-worker` usa zero-downtime (checagem `uptime=10`): no `ps:restart` o antigo e o novo ficaram ~20 s juntos no mesmo SQLite; cada sorteio rodou uma vez só. Com o worker parado (`ps:stop`), um sorteio pedido ficou `pendente` e concluiu ~9 s depois do `ps:start` (24 s no total) | Dois workers no mesmo `ow.db` é seguro; pendentes acumulados são processados na volta | Nada; e2e de produção cobre (`testes/e2e-producao.ts`) |
| 2026-11-20 | Front / `@instantdb/svelte` | **Sem surpresas** com o instantdb-rust (pergunta 1): `useAuth`, `useQuery` com `where` por link (`organizador.id`, `usuario.id`) + booleano (`removido: false`) e sub-consulta, `sendMagicCode` → `{sent: true}`, `signInWithMagicCode`, `signOut`, tudo no build de produção num Chromium headless e num script Bun com o core. Código já usado volta `Record not found: app-user-magic-code`. CORS do servidor é `*`. Única regra do SDK: `useQuery`/`useAuth` só durante a inicialização do componente (usam `$effect`), então o estado compartilhado vai num contexto criado no layout | SDK Svelte serve ao Pluto sem adaptação | `app/src/lib/sessao.svelte.ts` (contexto com auth + Meus grupos) |
| 2026-11-20 | Front / SvelteKit 3 | O `sv create` atual gera **SvelteKit 3** (Vite 8): `$env/static/public` virou alias **depreciado** de `$app/env/public`, que só exporta variáveis declaradas em `src/env.ts` (`defineEnvVars`, `public`/`static`); imports `#lib/*` (subpath imports, no lugar de `$lib`) exigem extensão (`#lib/instant.js`); `goto` para rota inexistente **lança** `navigation_route_missing` | Brief/planos escritos para o Kit 2 precisam de tradução | `src/env.ts` + `$app/env/public`; rotas provisórias "em construção" para `/criar`, `/entrar-grupo`, `/g/[codigo]`, `/grupos/[id]`, `/conta` (Tasks 11–14 substituem) |
| 2026-11-20 | Login / e-mail | Com `EMAIL_PROVIDER=log` no Instant, o magic code **não chega** a ninguém: em produção o login por código só funciona para quem lê o log ou usa `admin.auth.generateMagicCode(email)` (foi assim no teste) | Antes de abrir para pessoas de fora: provedor de e-mail no Instant ou Google ligado | Ligar `PUBLIC_LOGIN_GOOGLE=on` (fim do piloto) ou configurar e-mail; decidir antes de convidar gente |
| 2026-11-20 | Instant / dash API | O admin token do app vale como `Bearer` em `/dash/apps/<id>/auth` e `/dash/apps/<id>/authorized_redirect_origins` (serviço `generic`, `params: [host]`); `DELETE .../authorized_redirect_origins/<id>` remove | Origens do OAuth gerenciáveis por script, sem painel | `infra/instant-origens.sh` reconcilia a lista (adiciona e remove) |
| 2026-11-20 | Cloudflare Pages | (1) `wrangler@4` 4.166 `pages project create` tenta "delegar" para Workers e falha na raiz de um monorepo; com `--force` cria o Pages clássico. (2) `amigo-secreto.pages.dev` já era de outra conta: o projeto ganhou **`amigo-secreto-hws.pages.dev`** (a origem errada que o script tinha cadastrado no Instant foi removida). (3) O domínio `amigo.tpou.gy` ficou `pending` ("CNAME record not set"): o token OAuth do wrangler só **lê** a zona e o Pages não cria o DNS sozinho | Nome de subdomínio `*.pages.dev` não é garantido; DNS de domínio próprio exige token com escrita na zona | `infra/pages.sh` com `--force` só na criação; **pendente: Thomaz criar CNAME `amigo` → `amigo-secreto-hws.pages.dev` (proxied)** |
| 2026-11-20 | Schema / prévia | A prévia por código não consegue mostrar quem organiza: `$users.view` é só o próprio e `participantes.view` não aceita `ruleParams`. Decisão: atributo desnormalizado `grupos.organizadorApelido` (opcional), gravado na criação; a prévia continua **sem** contagem de participantes (privacidade) | Dado "público por código" de um registro privado vira cópia explícita no registro público, em vez de afrouxar a regra do privado | `instant.schema.ts`, `paraTransacao`, `PreviaGrupo`, página do grupo; teste "organizadorApelido" em `permissoes.grupos.test.ts` |
| 2026-11-20 | Permissões / remoção | O organizador não vê o `$users` nem as respostas do membro, mas a remoção pós-sorteio precisa desligar `usuario` e apagar as respostas. Saída: o id do usuário vem da `chave` do participante (`<grupoId>:<userId>`) e as respostas são apagadas por `lookup("chave", "<participanteId>:<campoId>")`; `delete` por lookup de chave inexistente é no-op (não falha a transação) | Chaves compostas determinísticas servem também para agir sobre registros que a regra esconde | Teste "remoção pela UI" em `permissoes.grupos.test.ts`; `Participantes.svelte` |
| 2026-11-20 | Schema / banner | "Alguém saiu depois do sorteio" não dá para derivar no cliente: o organizador não vê pares, e `removido` sozinho deixaria o banner preso depois de refazer. Novo `participantes.removidoNaRodada` (opcional; organizador e o próprio podem gravar, junto com `removido`); o banner aparece só se `removidoNaRodada == rodadaAtual` | Estado "evento aconteceu nesta rodada" precisa ser gravado, não inferido, quando a regra esconde a evidência | `regras.ts` (`bannerRemovidoAposSorteio`) + testes; a Task 14 (apagar conta) deve gravar `removidoNaRodada` |
| 2026-11-20 | Worker / UI ao vivo | Em produção, o organizador clica Sortear e a aba vê `pendente → processando → concluido` em ~0,8 s pela assinatura do `useQuery`; com restrições impossíveis o erro chega ao vivo, a chave renomeada libera a rodada e "Tentar de novo" conclui a mesma rodada 1 | A cadeia cliente → Instant → worker → Instant → cliente é rápida o bastante para status "ao vivo" sem polling | Smoke headless da Task 13 |
| 2026-11-20 | Produto / "viu o par" | `viuParNaRodada` é gravado quando o par fica **visível**; a UI entrega o par "embrulhado" e só revela num toque. Assim o organizador (que também participa) pode abrir a página para administrar, ou refazer, sem contar como "já viu" | "Abrir a página" ≠ "ver o resultado": medir a ação explícita | `VoceTirou.svelte` |
| 2026-11-20 | Storage / capa | Storage e Streams do Instant self-hosted funcionam pelo admin e pelo cliente (`uploadFile`, `$files`, `createWriteStream/ReadStream`). A `url` de `$files` é assinada (`/storage/serve/...?d=...&sig=...`): quem tiver a URL baixa até expirar; a regra controla quem **recebe** a URL | Arquivos privados do Pluto: a regra de `$files.view` é a barreira; não logar nem compartilhar URLs | Regras de `$files` por prefixo de path (`grupos/<id>/`) + teste membro/não-membro em `permissoes.conta.test.ts` |
| 2026-11-20 | Permissões / auth.ref | `auth.ref('$user.gruposOrganizados.id').exists(g, data.path.startsWith('grupos/' + g + '/'))` funciona no instantdb-rust, assim como ternário em `bind`. Serve para checar no **upload** (quando o arquivo ainda não tem link) e para `$streams` (o `clientId` só tem o id do sorteio) | Padrão para recursos sem link no momento da criação | `$files` e `$streams` em `instant.perms.ts`; teste de mutação (view "true") derrubou os 2 testes |
| 2026-11-20 | Consulta / link escondido | Quando a regra esconde o alvo de um link has-one, o instantdb-rust devolve o **id** (string) no lugar do objeto (ex.: `grupos.capa` na prévia por código). Não vaza path nem URL, mas quebra quem espera objeto ou `null` | Tratar link escondido como "id solto" no cliente | `urlCapa()` aceita string/objeto; teste na prévia |
| 2026-11-20 | SDK cliente / transação | O `transact` do `@instantdb/core` volta `{status: "enqueued"}`; desligar o cliente (`shutdown`) ou sair (`signOut`) logo depois pode perder a transação | Ações que terminam em logout precisam confirmar no servidor antes | `/conta` confirma o pedido com `queryOnce` antes do `signOut`; testes esperam o commit antes de desligar o cliente |
| 2026-11-20 | Permissões / sair do grupo | Sair do grupo (delete do próprio participante) falhava quando a pessoa estava numa restrição: a cascata checa o `delete` da restrição (mesmo achado da T6). 1ª versão liberou `restricoes.delete` para quem é citado; na revisão, trocado por **tirar a cascata** de `restricoes.participanteA/B`: a restrição fica órfã (o sorteio já ignora, a UI mostra "Ignorada") e `restricoes.delete` voltou a ser só do organizador | Preferir órfão inofensivo a afrouxar a regra do filho; cascata herda a regra de delete dos filhos | Schema sem cascata; testes "sair do grupo" (restrição órfã, citado não apaga) e "6b" no worker |
| 2026-11-20 | Schema / CLI | `instant-cli push` mostra "REMOVE CASCADE DELETE" e diz "Schema updated!", mas o instantdb-rust **não aplica**: o push seguinte mostra a mesma mudança e o delete continua em cascata. Contorno: push sem os links (DELETE LINK) e push de novo com eles (CREATE LINK, sem cascata), o que apaga os vínculos existentes (prod e teste tinham 0 restrições) | Mudar `onDelete` de link existente exige recriar o link e migrar os dados | Feito em teste e prod; conferido com delete de participante (restrição fica, link vazio) |
| 2026-11-20 | Permissões / capa | `$files` aceita regra de `link` (`grupoCapa`: o path tem de ser `grupos/<linkedData.id>/`). Sem ela, o organizador de X podia ligar a X um arquivo solto de Y (se soubesse o id); ligar a capa já ligada de Y dá `record-not-unique` (has-one) | Regras de link em entidades de sistema funcionam | Teste "organizador não liga ao próprio grupo a capa de outro grupo" + mutação |
| 2026-11-20 | Conta / exclusão | Excluir conta = `pedidosExclusao` (cliente cria, só ligado ao próprio `$users`) + workflow `apagar-conta` no worker (anonimiza nos grupos sorteados com `removidoNaRodada`, apaga participações abertas e grupos organizados com a capa, conclui o pedido, `auth.deleteUser`). Tudo numa transação, recalculada do estado atual (idempotente). ~0,3–0,7 s no teste. O pedido fica órfão como registro (só data e status) | Fluxo "cliente pede, worker executa como admin" serve para qualquer operação que a regra não pode liberar | `worker/workflows/apagarConta.ts` + testes; `planoApagarConta` em `dominio/conta.ts` |
| 2026-11-20 | Streams / tipos | `$streams` não está no schema do app: o admin com schema recusa consultá-lo (precisa de um `init` sem schema) e `InstantRules<AppSchema>` não aceita a chave (as regras ficam fora do `satisfies`). Cada sorteio deixa um `$streams` (poucos bytes, sem dado pessoal), sem limpeza. Em produção o sorteio leva ~100 ms no worker: no smoke, a fase do stream chegou ao navegador em 1 de 3 execuções (`embaralhando → sorteando → pronto`); nas outras o sorteio acabou antes de o leitor se conectar e valeu o fallback pelo `status` | Streams no Pluto: prever limpeza (job) e tipos; streams compensam em tarefas longas (agentes), não em operações de 100 ms | Registrado; limpeza fica para depois do piloto |

Perguntas que o piloto deve responder:

1. O `@instantdb/svelte` funciona sem surpresas com o instantdb-rust?
2. O padrão `ruleParams` resolve "ver com o código certo, sem permitir enumeração"?
3. As regras expressam "o organizador administra, mas não vê" sem gambiarra?
4. Os campos configuráveis em JSON são confortáveis de consultar e evoluir? Algo nisso muda a modelagem do plano?
5. O worker com `subscribeQuery` é confiável o suficiente para os agentes do Pluto?
6. O MCP com Google funciona no Claude e no ChatGPT, e a sessão sobrevive a uma semana?
7. Quanto de memória a VPS usa com um app real? Cabe o Pluto?
8. O atrito do modo de teste do Google é aceitável com pessoas de fora?
9. Algo no deploy ou na evolução de schema foi doloroso a ponto de mudar a etapa zero?