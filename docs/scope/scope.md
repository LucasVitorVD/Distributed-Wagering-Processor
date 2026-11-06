# Scope: Distributed Wagering Processor

Este documento separa o MVP que está implementado do que continua pendente. O projeto é um desafio técnico e não deve ser tratado como pronto para produção.

## Status do MVP

O MVP síncrono está implementado sobre PostgreSQL. Na última validação, `bun run test:integration` executou a build e passou **35 testes de integração em 4 arquivos**, usando um PostgreSQL descartável real.

| Capacidade | Status | Evidência principal |
|---|---|---|
| Repositórios e unidade de trabalho transacional | Implementado | Locks, rollback, constraints e ledger imutável; `test/wagering-repositories.integration-spec.ts` |
| Criação de carteira BRL | Implementado | `POST /wallets`, com lançamento `OPENING` atômico para saldo inicial positivo |
| Consulta de carteira e ledger | Implementado | `GET /wallets/:walletId` e paginação por cursor em `GET /wallets/:walletId/ledger` |
| Transações de wagering | Implementado | GET por ID e provedor; POST síncrono para BET, WIN, LOSS, REFUND e ROLLBACK |
| Idempotência e concorrência | Implementado | Chave e hash persistidos no PostgreSQL; locks e constraints aplicam-se entre instâncias |
| Reconciliação | Implementado | Compara saldo armazenado ao ledger, sinaliza divergência e não corrige dados |
| Health checks | Implementado com limite | Liveness verifica o processo; readiness exige PostgreSQL e SQS acessíveis |
| Logs e métricas síncronas | Implementado parcialmente | JSON estruturado, correlação HTTP e métricas dos fluxos síncronos |

## O que está fora do MVP

### Segurança antes de exposição pública

Nenhuma rota da aplicação deve ser exposta publicamente com dados financeiros reais enquanto não houver:

- autenticação de provedores e autorização baseada na identidade autenticada;
- verificação de escopo/propriedade para consultas e operações sobre carteiras;
- rate limiting e proteção apropriada dos endpoints operacionais, inclusive `/metrics` e health checks.

Os `providerId` recebidos hoje são valores declarados na requisição, não identidades autenticadas.

### Processamento assíncrono

Não há produtor/consumidor SQS, publicação de eventos, outbox transacional, retry de mensagens ou DLQ. A prontidão verifica acesso à fila SQS, mas isso **não** significa que o processamento de mensagens esteja implementado.

Se o desafio exigir essa parte, o próximo slice deve decidir e documentar o fluxo, cobrindo publicação confiável após commit (por exemplo, via outbox), consumo idempotente, política de retry/backoff, DLQ e testes de integração com PostgreSQL e SQS real ou local compatível. Métricas de outbox lag e contagem de DLQ só fazem sentido depois que esses componentes existirem.

### Operação de produção

Ainda devem ser definidos conforme o ambiente-alvo: gestão de migrations e deploy, backups e recuperação, retenção dos registros de auditoria, alertas, tracing distribuído e dashboards.

## Validação

```bash
bun run test
bun run test:integration:db:up
bun run test:integration
bun run test:integration:db:down
```

`bun run test:integration` executa a build antes da suíte de integração. A última execução passou com 35 testes PostgreSQL. Testes unitários podem usar mocks para isolar regras; eles complementam, mas não substituem, a suíte de integração com PostgreSQL.

## Specs do MVP

- [0001 — Repositórios para processamento BET](../specs/0001-bet-repositories/index.md)
- [0002 — Criação de carteiras](../specs/0002-wallet-creation-api.md)
- [0003 — Consultas de carteiras](../specs/0003-wallet-query-api.md)
- [0004 — API de transações de wagering](../specs/0004-wagering-transactions-api/index.md)
