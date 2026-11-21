# Reabrir grupo depois do sorteio — design

**Data:** 2026-11-20 · **Status:** aprovado (Thomaz)
**Base:** `docs/superpowers/specs/2026-11-20-amigo-secreto-design.md`, cujas regras, restrições e anti-objetivos continuam valendo.

## Intenção

Depois do sorteio, alguém descobre que faltou uma pessoa. O organizador **desfaz o sorteio**, o grupo volta a aceitar entradas pelo código ou QR, o retardatário entra e preenche o perfil, e o organizador sorteia de novo.

## Decisões

- **Limite de rodadas (opção B, escolhida pelo Thomaz):** o limite é de **3 sorteios por abertura**. Reabrir grava `grupos.rodadaBase = rodadaAtual`, e o limite passa a ser `rodada − rodadaBase ≤ 3`. O número da rodada continua crescendo, porque ele faz parte da chave única `<grupoId>:<rodada>` de cada sorteio. O ciclo reabrir → sortear sem fim é aceito. Os freios são a confirmação forte e o limite de taxa.
- **Quem desfaz é o worker, não o navegador:** o organizador não enxerga os pares por regra, então não consegue apagá-los. Por isso o organizador cria uma entidade `reaberturas` e o worker executa o workflow `reabrir-grupo`, no mesmo padrão de `pedidosExclusao` (campainha genérica, `dispararComRetomada`).
- **Confirmação, igual à do refazer:**
  - **simples**, se ninguém viu o par: "Reabrir desfaz o sorteio. Ninguém viu o resultado ainda.";
  - **forte**, se alguém viu: "<n> pessoa(s) já viram quem tiraram. Reabrir desfaz o sorteio de todos.", com o organizador digitando `REABRIR`.

## Comportamento

1. O botão **"Reabrir grupo para novos participantes"** aparece na aba Sorteio só quando o grupo está `sorteado` e não há sorteio `pendente` ou `processando`. Não há limite de rodadas para reabrir.
2. O app cria `reaberturas` com `status: "pendente"` e `criadoEm`, ligada ao grupo.
3. O worker roda numa única transação, como admin:
   - confere que o grupo existe, está `sorteado` e não tem sorteio em andamento; se não, marca a reabertura como `erro` com uma mensagem legível;
   - apaga todos os `pares` do grupo;
   - grava `grupos.status = "aberto"` e `grupos.rodadaBase = grupos.rodadaAtual`;
   - marca a reabertura como `concluido`.

   O workflow é idempotente: uma reabertura que já está `concluido` não faz nada. Os logs levam só ids.
4. Com o grupo `aberto`, a entrada por código e QR volta a funcionar pelas regras atuais.
5. Os participantes veem, quando o grupo está `aberto` e `rodadaAtual > 0`: **"O sorteio foi desfeito pelo organizador para incluir mais gente. Aguarde o novo sorteio."**
6. O MCP `meu_amigo_secreto` responde que o sorteio ainda não aconteceu, porque não existe par.
7. O novo sorteio segue o fluxo normal. A "rodada N de 3" exibida passa a ser `rodadaAtual − rodadaBase`.

## Schema e regras

- `grupos.rodadaBase`: número opcional, tratado como 0 quando ausente. Só o worker (admin) escreve; o organizador não pode mudá-lo, da mesma forma que `rodadaAtual`.
- `reaberturas`: `status` (string indexada: `pendente`/`concluido`/`erro`), `erro` (string opcional), `criadoEm` (date). Link `reaberturas.grupo` → `grupos.reaberturas`, de um para muitos, com cascata a partir do grupo.
  - **view:** membros do grupo e o organizador;
  - **create:** só o organizador, com `status == 'pendente'`, grupo `sorteado`, sem sorteio `pendente` ou `processando`, e `rateLimit.reabertura` (5 por hora);
  - **link:** só na criação, pelo organizador do grupo;
  - **update e unlink:** `false`;
  - **delete:** só o organizador (`ehOrganizador`). O servidor checa `delete` também nos filhos apagados em cascata, então sem isso o organizador não apagaria o grupo depois de reabrir; não dá poder novo, porque ele já pode apagar o grupo inteiro. Por isso o worker confere que a reabertura ainda existe antes de marcá-la `concluido`/`erro` (um `update` admin em id apagado recriaria a reabertura como fantasma).
- `sorteios.create`: troca `data.rodada <= 3` por "rodada − rodadaBase ≤ 3" (sem `rodadaBase`, vale 0).

## Testes

- **Regras:**
  - membro não reabre;
  - não se reabre grupo `aberto`, `encerrado` ou com sorteio em andamento;
  - depois de reabrir, ninguém vê pares antigos;
  - o retardatário entra;
  - o sorteio da rodada `rodadaBase + 1` é aceito, e o de `rodadaBase + 4` é recusado.
- **Worker:**
  - reabrir apaga os pares e grava `rodadaBase`;
  - a idempotência vale mesmo apagando o `ow.db`;
  - grupo apagado ou encerrado no meio dá `erro` e não deixa registros fantasma;
  - ciclo completo: reabrir, retardatário entra, sortear de novo, todos com exatamente 1 par.
- **App:** testes unitários da confirmação (os dois níveis e os textos exatos) e da contagem "rodada N de 3".
- **e2e de produção:** ganha o ciclo com retardatário.

## Fora do escopo

Notificação ativa (e-mail ou push) para quem já tinha visto o par.
