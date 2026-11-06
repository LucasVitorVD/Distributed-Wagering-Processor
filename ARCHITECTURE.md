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

## Representação de valores monetários

- Valores monetários não usam `number`, `float` ou `double`.
- `Money` é uma classe de domínio imutável, sem dependência de ORM/NestJS.
- Entrada e saída são strings decimais com escala fixa de 2 casas (`BRL` no MVP; modelo preparado para multi-moeda).
- A persistência separa valor (`balance_amount`, `numeric(18,2)`) e moeda (`balance_currency`, `varchar(3)`).
- Validações de domínio rejeitam `NaN`, `Infinity`, notação científica, string vazia, mais de 2 casas, zeros à esquerda na entrada, valores negativos em contratos de entrada.

## Transações e concorrência

- Unidade de concorrência: `walletId`.
- Estratégia: bloqueio pessimista por carteira (`SELECT ... FOR UPDATE`) dentro de uma transação SQL (`Unit of Work`). O wagering usa `findByPlayerAndCurrencyForUpdate`; a reconciliação usa `findByIdForUpdate`. Os locks evitam atualizações perdidas quando múltiplas instâncias disputam o mesmo saldo.
- `version` inicia em 1 e incrementa somente quando o saldo muda. O MVP não usa esse campo para optimistic locking.
- As operações em carteiras diferentes não compartilham um lock global e podem prosseguir em paralelo.
- A leitura e atualização do saldo ocorrem sob o lock da carteira. Os métodos de débito e crédito do aggregate `Wallet` alteram o saldo na mesma transação que grava o ledger.

## Atomicidade e ledger

- O fluxo síncrono grava a carteira, a transação de wagering e o lançamento do ledger, quando houver efeito no saldo, no mesmo `COMMIT`.
- O MVP não implementa inbox nem processamento de mensagens. Uma integração assíncrona requer deduplicação persistida para impedir que a mesma mensagem aplique efeitos financeiros mais de uma vez.
- Ledger imutável: trigger de banco impede `UPDATE`/`DELETE` em `wallet_ledger_entries`; `UNIQUE (wallet_id, transaction_id)` garante no máximo um lançamento por transação por carteira.
- O débito não usa uma leitura de saldo fora da transação. O saldo da carteira e o `balance_after` do ledger resultam da mesma operação.

## Idempotência

- O header obrigatório `Idempotency-Key` é a fonte de verdade. O formato recomendado é `"{providerId}:{externalTransactionId}"`.
- `payloadHash` = SHA-256 de JSON canônico (chaves ordenadas recursivamente) dos campos de negócio. O header e os metadados de transporte não entram no hash.
- A chave e o hash são persistidos no PostgreSQL, com unicidade por chave. A mesma chave e o mesmo payload retornam replay (`idempotentReplay: true`) sem repetir efeitos; a mesma chave com payload diferente retorna `409 IDEMPOTENCY_CONFLICT`.
- Como a idempotência é persistida no PostgreSQL, ela permanece disponível após reinicializações e entre instâncias da aplicação.

## Autenticação e autorização pendentes

- O MVP não implementa autenticação nem autorização.
- No limite HTTP, um guard NestJS deverá validar credenciais de um provedor de identidade, como tokens OpenID Connect (OIDC), antes de chamar os serviços de aplicação. O contexto da requisição deverá receber somente a identidade extraída de claims validados.
- A autorização deverá vincular a identidade autenticada ao provedor e aos recursos de carteira permitidos. O `providerId` recebido no corpo ou na URL é um identificador declarado pelo cliente, não uma prova de identidade.
- A autenticação deverá proteger as rotas de negócio de carteiras, wagering e reconciliação. Health checks e métricas exigem políticas próprias; `/metrics` e endpoints operacionais deverão ficar restritos à rede ou ao sistema de monitoramento autorizado.
- O MVP não armazena senhas nem implementa um provedor de identidade próprio. A validação de tokens de um provedor existente evita criar um mecanismo de autenticação artesanal.
- O rate limiting permanece pendente. A aplicação ou um gateway confiável poderá aplicar esse controle.

## Eventos e outbox (fora do MVP)

- O código atual não define eventos de integração nem uma inbox ou outbox.
- Não há publisher ou worker SQS. Portanto, o serviço não publica eventos e não implementa retries de mensagens, backoff, DLQ ou confirmação após processamento.
- Uma eventual integração assíncrona com SQS requer uma outbox transacional, que registre a intenção de publicação junto com a transação financeira. Um worker publica os eventos após o commit. O consumidor processa cada mensagem de forma idempotente e confirma seu recebimento somente depois de persistir o resultado.
- As métricas de atraso da outbox e contagem da DLQ só poderão ser adicionadas quando esses componentes existirem.

## Observabilidade

- Logs estruturados JSON com `correlationId`, `messageId`, `transactionId`, `walletId`, `providerId` (sem payloads financeiros completos).
- Métricas Prometheus em `/metrics`: transações por status, duplicatas, conflitos de idempotência, replays, conflitos de lock, duração de processamento, divergências de reconciliação.
- Health checks: `/health/live` verifica o processo; `/health/ready` verifica PostgreSQL e SQS. SQS fica `down` quando a fila não está configurada ou acessível.

## Limitações conhecidas do MVP

- Autenticação e autorização de provedor não implementadas.
- Sem processamento assíncrono, consumidor SQS, inbox, outbox, retry com backoff ou DLQ.
- Sem deduplicação baseada em broker (SQS FIFO não é confiável único).
- Sem métricas de outbox lag nem DLQ (componentes inexistentes).
- A API não deve ser exposta publicamente com dados financeiros reais antes da implementação de segurança, incluindo TLS, autenticação, autorização e rate limiting.

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
