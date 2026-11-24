# Contador de grupos na landing — design curto

**Data:** 2026-11-24 · **Status:** aprovado (Thomaz)

## Intenção
Mostrar na landing page quantos amigos secretos já foram organizados na plataforma. O número é exato desde o início, como um contador de piloto, mesmo pequeno.

## Abordagens
- **O worker conta e grava um registro público (escolhida).** As regras impedem listar grupos alheios, e isso é o que evita a descoberta de grupos. Por isso só o admin conta. A landing lê um registro só.
- Incrementar pelo cliente ao criar um grupo: não é confiável, porque qualquer cliente mexeria no número.
- Número fixo no build: fica desatualizado.

## Comportamento
- **"Organizado"** = todo grupo criado. O contador só sobe: apagar o grupo ou a conta não diminui o número.
- **Entidade `estatisticas`:** registro único, de id fixo `ESTATISTICAS_ID` em `@amigo/dominio`, com:
  - `gruposOrganizados: number`
  - `contadoAte: date`, a criação do grupo mais recente já contado
  - `atualizadoEm: date`
  - Regras: `view: true`, inclusive para visitante sem login. `create`, `update` e `delete` são `false`; só o admin, que é o worker, grava.
- **Contagem, função pura `atualizarContagem(anterior, criadosEm)`** em `@amigo/dominio`:
  - sem registro anterior: o total é a quantidade de grupos existentes;
  - com registro: soma os grupos com `criadoEm > contadoAte`.
  - O resultado depende só do estado anterior e dos grupos atuais, então duas execuções simultâneas gravam o mesmo valor.
  - Os grupos do e2e de produção (título começando com `e2e-`) ficam de fora.
  - Um grupo criado e apagado antes da contagem seguinte não entra.
- **Worker:** workflow `atualizar-estatisticas`, sem versão (exigência do agendamento), com cron `0 * * * *` em `America/Sao_Paulo`. Também é disparado uma vez ao iniciar.
- **Landing:** uma faixa entre os passos e o aviso de privacidade, com o número em destaque.
  - Texto: "**127** amigos secretos já organizados", formatado em pt-BR. No singular: "**1** amigo secreto já organizado".
  - Some enquanto carrega e quando o registro não existe.

## Fora do escopo
Outras métricas (participantes, sorteios) e histórico por período.
