# Arquitetura — Distributed Wagering Processor (MVP)

## Resumo

Serviço síncrono de processamento de transações de apostas (wagering) para carteiras BRL. O MVP prioriza correção financeira, idempotência persistida e consistência entre saldo e ledger, validadas com PostgreSQL real. Autenticação, processamento assíncrono com SQS, outbox transacional e DLQ ainda não estão implementados.

## Stack

| Item | Escolha | Justificativa |
|---|---|---|
| Runtime, gerenciador de pacotes e testes | Bun 1.x | Requisito do desafio; reúne execução, instalação e testes. |
| Framework | NestJS 12 | Requisito do desafio; módulos e injeção de dependência. |
| ORM | MikroORM 6 (PostgreSQL) | Preferência do desafio; Unit of Work, Identity Map, `EntityManager.transactional()` e `LockMode`. |
| Banco de dados | PostgreSQL 16 | Requisito do desafio; constraints de integridade e transações ACID. |
| Mensageria | Não implementada | SQS e LocalStack não fazem parte do MVP atual. |

## Modelagem de dinheiro (invariante inquebrável)

- Nunca `number`, `float` ou `double` para dinheiro.
- `Money` é uma classe de domínio imutável, sem dependência de ORM/NestJS.
- Entrada e saída são strings decimais com escala fixa de 2 casas (`BRL` no MVP; modelo preparado para multi-moeda).
- Persistência: colunas separadas `balance_amount` (`numeric(18,2)`) + `balance_currency` (`varchar(3)`), não um tipo monetário do ORM.
- Validações de domínio rejeitam `NaN`, `Infinity`, notação científica, string vazia, mais de 2 casas, zeros à esquerda na entrada, valores negativos em contratos de entrada.

## Transações e concorrência

- Unidade de concorrência: `walletId`.
- Estratégia: bloqueio pessimista por carteira (`SELECT ... FOR UPDATE` via `findByIdForUpdate`) dentro de uma transação SQL (`Unit of Work`). Evita lost update quando múltiplas instâncias disputam o mesmo saldo.
- `version` inicia em 1 e incrementa somente quando o saldo muda (sugestão para optimistic locking; não usada ativamente no MVP).
- Nenhum lock global compartilhado por todas as carteiras; wallets diferentes processam em paralelo.
- Nunca `read → calculate → update` sem controle de concorrência: débito/credito são métodos do aggregate `Wallet` que mutam o estado dentro da mesma transação que grava o ledger.

## Atomicidade e ledger

- O fluxo síncrono grava a carteira, a transação de wagering e o lançamento do ledger, quando houver efeito no saldo, no mesmo `COMMIT`.
- Não há inbox nem processamento de mensagens no MVP. Se o consumo assíncrono for implementado, a deduplicação da mensagem também precisará de persistência transacional.
- Ledger imutável: trigger de banco impede `UPDATE`/`DELETE` em `wallet_ledger_entries`; `UNIQUE (wallet_id, transaction_id)` garante no máximo um lançamento por transação por carteira.
- Sem leitura do saldo para decidir débito fora da transação: o saldo materializado na wallet e o `balance_after` do ledger são derivados da mesma operação.

## Idempotência

- Fonte da verdade: header `Idempotency-Key`, obrigatório, recomendado `"{providerId}:{externalTransactionId}"`.
- `payloadHash` = SHA-256 de JSON canônico (chaves ordenadas recursivamente) dos campos de negócio. O header e os metadados de transporte não entram no hash.
- Persistida no PostgreSQL (única por chave); mesma key + payload igual → replay com `idempotentReplay: true`, sem duplicar efeito. Mesma key + payload diferente → `409 IDEMPOTENCY_CONFLICT`.
- Idempotência apenas em memória é expressamente proibida pelo desafio; aqui é persistida e sobrevive a reinicializações.

## Autenticação e autorização (pendentes)

- O MVP não implementa autenticação. Não há um `AuthGuard` no-op: um guard que sempre permite a chamada criaria uma falsa impressão de proteção.
- Antes da exposição pública, um guard real do NestJS deve validar credenciais emitidas por um provedor de identidade, por exemplo, tokens OIDC. A aplicação deve colocar no contexto da requisição apenas a identidade obtida de claims validados.
- A camada de autorização deve usar essa identidade para limitar transações ao provedor autenticado e consultas ou operações sobre carteiras aos recursos permitidos. Não trate `providerId` enviado no corpo ou na URL como prova de identidade.
- A proteção deve cobrir as rotas de negócio de carteiras, wagering e reconciliação. O README lista os endpoints atuais. Defina separadamente as políticas para health checks e métricas: não os proteja automaticamente como rotas de negócio; restrinja `/metrics` e os endpoints operacionais à rede ou ao sistema de monitoramento apropriado.
- Não crie autenticação própria com senhas armazenadas pela aplicação sem um requisito e desenho específicos. Prefira validar tokens de um provedor de identidade existente.
- Rate limiting também deve ser adicionado antes da exposição pública, na aplicação ou em um gateway confiável.

## Eventos e outbox (fora do MVP)

- O código atual não define eventos de integração nem uma inbox ou outbox.
- Não há publisher ou worker SQS. Portanto, o serviço não publica eventos e não implementa retries de mensagens, backoff, DLQ ou confirmação após processamento.
- Se o desafio exigir esse fluxo, desenhe uma outbox transacional para registrar a intenção de publicar na mesma transação financeira. Um worker poderá publicar depois do commit; o consumidor deverá ser idempotente e confirmar a mensagem somente após persistir o resultado.
- As métricas de atraso da outbox e contagem da DLQ só poderão ser adicionadas quando esses componentes existirem.

## Observabilidade

- Logs estruturados JSON com `correlationId`, `messageId`, `transactionId`, `walletId`, `providerId` (sem payloads financeiros completos).
- Métricas Prometheus em `/metrics`: transações por status, duplicatas, conflitos de idempotência, replays, conflitos de lock, duração de processamento, divergências de reconciliação.
- Health checks: `/health/live` verifica o processo; `/health/ready` verifica PostgreSQL e SQS. SQS fica `down` quando a fila não está configurada ou acessível.

## Limitações conhecidas do MVP

- Sem autenticação/autorização de provedor.
- Sem processamento assíncrono, consumidor SQS, inbox, outbox, retry com backoff ou DLQ.
- Sem deduplicação baseada em broker (SQS FIFO não é confiável único).
- Sem métricas de outbox lag nem DLQ (componentes inexistentes).
- Não exponha a API publicamente com dados financeiros reais sem camada de segurança (TLS, auth, rate limiting).

## Comandos

```bash
# Dependências
bun install

# Banco local
docker compose up -d postgres

# Migrations
bun run migration:up

# App
bun run start:dev

# Testes
bun run test                 # unitários
bun run test:integration:db:up
bun run test:integration     # integração PostgreSQL real (35 testes)
bun run test:integration:db:down
bun run test:e2e             # e2e (24 testes)
```
