# Perfis visíveis entre participantes — design curto

**Data:** 2026-11-23 · **Status:** aprovado (Thomaz)

## Intenção
Deixar o organizador permitir que os participantes vejam o perfil (as respostas) uns dos outros. Por padrão fica desligado, porque a graça é o perfil ser surpresa para quem não tirou a pessoa.

## Hoje
- Todo membro vê a lista de participantes, com os apelidos.
- As respostas só são visíveis para o dono e para quem tirou o dono (`respostas.view = ehDono || tirouODono`). Nem o organizador vê.

## Abordagens
- **Flag no grupo + regra no Instant (escolhida).** O bloqueio já está no servidor, então a regra passa a liberar a leitura quando a flag estiver ligada. O MCP herda o comportamento sem código, porque usa `asUser`.
- Só esconder na tela: inseguro, porque as respostas ficariam legíveis para qualquer cliente.
- Worker copiando os perfis para uma entidade pública: duplica dados sem ganho.

## Comportamento
- **Atributo novo:** `grupos.perfisVisiveis: boolean` opcional. Ausente vale falso, então os grupos que já existem ficam desligados e não há migração.
- **Configurações** (aba do organizador): interruptor "Participantes podem ver o perfil uns dos outros". Grava na hora e pode ser mudado a qualquer momento, antes ou depois do sorteio.
  - A regra atual de `grupos.update` já permite isso (`perfisVisiveis` não é campo protegido).
  - O grupo encerrado continua editável pelo organizador, como os demais campos.
- **Regra:**
  - `respostas.view` passa a ser `ehDono || tirouODono || ((ehMembro || ehOrganizador) && perfisVisiveis)`.
  - `ehMembro` é ter usuário ligado a um participante do grupo da resposta; o organizador entra explicitamente.
  - Quem foi removido depois do sorteio está desligado do usuário e não conta como membro.
  - Com a flag desligada, tudo continua como hoje.
- **Tela:**
  - Com a flag ligada, os nomes ativos da lista (inclusive o próprio) viram botões.
  - Clicar abre um diálogo com o apelido e as respostas na ordem dos campos. A exibição das respostas é reaproveitada da de "Você tirou".
  - Sem respostas: "Ainda não preencheu o perfil."
  - Participantes removidos não são clicáveis.
  - Com a flag desligada, a lista fica igual a hoje.
- **Dados do diálogo:** consulta própria, ao abrir, das respostas daquele participante (`participantes[id].respostas.campo`). As regras recortam o resultado.
- **Testes:** testes de permissão no app de teste, cobrindo:
  - flag desligada: o membro não vê;
  - flag ligada: o membro vê;
  - um estranho não vê, mesmo com a flag ligada;
  - quem foi removido depois do sorteio não vê;
  - flag ligada e depois desligada: o membro volta a não ver.

## Fora do escopo
- Ferramenta do MCP para consultar o perfil de outro participante. A regra já permite; fica para quando for pedida.
- Visibilidade por campo.
