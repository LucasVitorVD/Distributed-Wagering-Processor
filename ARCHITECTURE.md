# Arquitetura — Distributed Wagering Processor (MVP)

## Resumo

Serviço síncrono de processamento de transações de apostas (wagering) para carteiras BRL. Foco do MVP: correção financeira, idempotência persistente e consistência saldo ↔ ledger contra PostgreSQL real. Autenticação, processamento assíncrono (SQS), outbox transacional e DLQ ainda não estão implementados.

## Stack

| Item | Escolha | Justificativa |
|---|---|---|
| Runtime / PM / test | Bun 1.x | Obrigado pelo desafio; execução rápida e pacote único. |
| Framework | NestJS 12 | Obrigado pelo desafio; módulos e DI padrões. |
| ORM | MikroORM 6 (PostgreSQL) | Preferido pelo desafio; Unit of Work explícito, Identity Map, `EntityManager.transactional()` e `LockMode`. |
| Banco | PostgreSQL 16 | Obrigado pelo desafio; constraints de integridade e transações ACID. |
| Mensageria | — (não implementado) | SQS/LocalStack fora do escopo do MVP por falta de tempo. |

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

- Uma transação financeira grava atomicamente: wallet, transação de wagering, lançamento de ledger (quando houver efeito no saldo) e inbox (quando vier de fila) no mesmo `COMMIT`.
- Ledger imutável: trigger de banco impede `UPDATE`/`DELETE` em `wallet_ledger_entries`; `UNIQUE (wallet_id, transaction_id)` garante no máximo um lançamento por transação por carteira.
- Sem leitura do saldo para decidir débito fora da transação: o saldo materializado na wallet e o `balance_after` do ledger são derivados da mesma operação.

## Idempotência

- Fonte da verdade: header `Idempotency-Key`, obrigatório, recomendado `"{providerId}:{externalTransactionId}"`.
- `payloadHash` = SHA-256 de JSON canônico (chaves ordenadas recursivamente) dos campos de negócio; transporte e header entram no hash.
- Persistida no PostgreSQL (única por chave); mesma key + payload igual → replay com `idempotentReplay: true`, sem duplicar efeito. Mesma key + payload diferente → `409 IDEMPOTENCY_CONFLICT`.
- Idempotência apenas em memória é expressamente proibida pelo desafio; aqui é persistida e sobrevive a reinicializações.

## Autenticação (decisão da seção 2)

- Não implementada. O desafio deixa a cargo do candidato e afirma que não vale pontos.
- Não há tabela própria de usuários nem hash de senha (evitar autenticação artesanal).
- Ponto de extensão deixado explícito: `AuthGuard` no-op / `ProviderIdentityPort` a ser implementado com um IdP externo (Keycloak/Zitadel) quando necessário.
- Endpoints de health ficam abertos, conforme especificado.

## Eventos e outbox

- Eventos mínimos definidos no modelo (`WagerTransactionProcessed`, `WagerTransactionRejected`, `WalletBalanceChanged`, `WagerTransactionPendingReference`) com envelope abstrato `IntegrationEvent<T>`.
- Nenhum publisher/worker SQS implementado no MVP; portanto não há publicação após commit, outbox transacional, retry, DLQ nem backoff.
- Limitação conhecida: regras 10 e 11 do desafio (SQS, outbox, ack após commit) não estão cobertas neste MVP.

## Observabilidade

- Logs estruturados JSON com `correlationId`, `messageId`, `transactionId`, `walletId`, `providerId` (sem payloads financeiros completos).
- Métricas Prometheus em `/metrics`: transações por status, duplicatas, conflitos de idempotência, replays, conflitos de lock, duração de processamento, divergências de reconciliação.
- Health checks: `/health/live` (processo) e `/health/ready` (PostgreSQL + SQS; SQS reporta `down` sem fila configurada).

## Limitações conhecidas do MVP

- Sem autenticação/autorização de provedor.
- Sem processamento assíncrono, consumidor SQS, inbox persistente para mensagens, outbox, retry com backoff ou DLQ.
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
