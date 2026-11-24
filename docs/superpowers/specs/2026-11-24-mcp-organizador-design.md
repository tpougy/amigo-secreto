# Ferramentas de organizador no MCP (baixo risco) — design curto

**Data:** 2026-11-24 · **Status:** aprovado (Thomaz: "pode implementar as ferramentas de baixo risco")

## Intenção
Deixar o organizador conferir e ajustar o grupo pelo assistente de IA, por exemplo "como está meu grupo?" ou "melhora as perguntas do perfil". Ações irreversíveis ficam de fora: sortear, refazer, reabrir, remover participante, encerrar e apagar.

## Abordagem
Três ferramentas novas, como as demais: funções em `mcp/ferramentas.ts` sobre o `db` impersonado (`asUser`). A permissão continua sendo a regra do Instant (`grupos.update` e `campos.*` só para o organizador). A ferramenta só confere antes, para explicar a recusa ("Só o organizador do grupo pode fazer isso").

As validações de título, descrição, datas, valor e campos saem do app (`criar/estado.svelte.ts`) para `@amigo/dominio` (`grupo.ts`). O app e o MCP passam a usar a mesma regra, com as mesmas mensagens.

## Ferramentas
- **`painel_grupo(grupo)`:** título, descrição, código, tema, status, rodada, datas (`AAAA-MM-DD`), valor sugerido, `perfisVisiveis`, participantes (`apelido`, `perfilCompleto`, `removido`), campos do perfil (`rotulo`, `tipo`, `obrigatorio`, `ajuda?`, `opcoes?`) e se há sorteio em andamento. Não devolve ids nem pares.
- **`editar_grupo(grupo, mudancas)`:** muda só o que vier, entre:
  - `titulo` (3 a 80 caracteres);
  - `descricao` (até 500; `null` apaga);
  - `dataSorteioPrevista` e `dataEvento` (`AAAA-MM-DD` ou `null`; o evento não pode ser antes do sorteio);
  - `valorSugerido` (≥ 0 ou `null`);
  - `perfisVisiveis`.
  - Valida com o estado final, que é o atual mais as mudanças.
- **`editar_campos_perfil(grupo, campos, confirmarRemocao?)`:** recebe a lista **final** de campos, na ordem desejada: `rotulo`, `tipo`, `obrigatorio`, `ajuda?`, `opcoes?` (para `multipla`/`unica`, ao menos 2) e `rotuloAtual?`.
  - Um campo existente é reconhecido pelo `rotuloAtual` (para renomear) ou pelo próprio `rotulo`, sem diferença de caixa. O que não for reconhecido é criado.
  - Campos existentes que ficarem de fora são **removidos**, o que apaga as respostas já dadas a eles. Sem `confirmarRemocao: true`, a ferramenta não muda nada e devolve um erro listando os campos que seriam removidos, para o assistente confirmar com o usuário.
  - Grava tudo numa transação só, como a tela de Configurações.

## Fora do escopo
Sortear, refazer, reabrir, remover participante, encerrar e apagar.
