# Distributed Wagering Processor

API de desafio técnico para manter carteiras BRL, processar transações de wagering de forma síncrona e registrar cada movimentação em um ledger auditável.

## Status do projeto

O MVP síncrono está implementado: criação e consulta de carteiras, consulta paginada do ledger, transações de wagering com idempotência persistida, reconciliação, health checks e observabilidade básica. A build e os 35 testes de integração PostgreSQL passaram na última validação.

Este MVP **não é um sistema completo de produção**. Ainda não há autenticação, autorização/escopo por provedor, limite de requisições, processamento assíncrono de mensagens, outbox ou DLQ. Não exponha a API publicamente com dados financeiros reais.

Veja o [scope e o backlog](docs/scope/scope.md) e as [decisões técnicas](ARCHITECTURE.md).

## Requisitos

- Bun
- Docker e Docker Compose
- PostgreSQL 16 (o Compose do projeto inicia um banco local)

## Executar localmente

Configure um `.env` local. Exemplo para desenvolvimento — troque os valores antes de qualquer ambiente compartilhado:

```dotenv
PORT=3000
POSTGRES_DB=wagering
POSTGRES_USER=wagering
POSTGRES_PASSWORD=dev-only-change-me
POSTGRES_HOST=localhost
POSTGRES_PORT=5433
```

Inicie o PostgreSQL, instale dependências, aplique as migrations e rode a API:

```bash
bun install
docker compose up -d postgres
bun run migration:up
bun run start:dev
```

O servidor escuta em `http://localhost:3000`. As migrations não são aplicadas automaticamente ao iniciar a aplicação. Não versione `.env` nem credenciais reais.

## Endpoints do MVP

| Método e rota | Descrição |
|---|---|
| `POST /wallets` | Cria uma carteira BRL; saldo inicial positivo gera transação `OPENING` e crédito no ledger. |
| `GET /wallets/:walletId` | Consulta saldo atual e versão da carteira. |
| `GET /wallets/:walletId/ledger?cursor=...&limit=50` | Consulta lançamentos mais recentes com paginação por cursor opaco. Limite padrão 50, máximo 100. |
| `POST /wagering/transactions` | Processa `BET`, `WIN`, `LOSS`, `REFUND` ou `ROLLBACK` de forma síncrona. |
| `GET /wagering/transactions/:transactionId` | Consulta uma transação pelo UUID interno. |
| `GET /providers/:providerId/wagering/transactions/:externalTransactionId` | Consulta uma transação pela identidade externa do provedor. |
| `POST /wallets/:walletId/reconciliation` | Compara o saldo da carteira com a soma do ledger; não corrige divergências. |
| `GET /health/live` | Indica que o processo está vivo, sem verificar dependências. |
| `GET /health/ready` | Indica prontidão somente se PostgreSQL **e SQS** estiverem acessíveis. |
| `GET /metrics` | Expõe métricas Prometheus. |

Todos os valores monetários são enviados como strings decimais, por exemplo `"25.50"`. Valores usam aritmética decimal, nunca ponto flutuante binário. O endpoint de criação de carteira aceita apenas BRL; o endpoint de wagering também processa valores em BRL.

### Criar carteira

```http
POST /wallets
Content-Type: application/json
```

```json
{
  "playerId": "2f986158-4ec9-4c7f-8ca1-f790a83af8df",
  "initialBalance": {
    "amount": "25.50",
    "currency": "BRL"
  }
}
```

Saldo zero cria somente a carteira. Saldo inicial positivo cria, na mesma transação PostgreSQL, uma transação `OPENING` processada e um lançamento de crédito. A resposta `201 Created` inclui `id`, `playerId`, `balance` e `version`.

### Enviar transação de wagering

Toda chamada `POST /wagering/transactions` exige `Idempotency-Key`. O valor recomendado é `{providerId}:{externalTransactionId}`.

```http
POST /wagering/transactions
Idempotency-Key: provider-a:transaction-123
Content-Type: application/json
```

```json
{
  "providerId": "provider-a",
  "externalTransactionId": "transaction-123",
  "playerId": "2f986158-4ec9-4c7f-8ca1-f790a83af8df",
  "roundId": "round-42",
  "gameId": "game-7",
  "kind": "BET",
  "amount": {
    "amount": "5.00",
    "currency": "BRL"
  }
}
```

Uma resposta nova tem o formato:

```json
{
  "transactionId": "c0fd57c1-3a77-4e1b-8673-5fc0fb3cafbe",
  "status": "PROCESSED",
  "balance": {
    "amount": "20.00",
    "currency": "BRL"
  },
  "idempotentReplay": false
}
```

O saldo na resposta é o saldo imediatamente após o resultado daquela transação, não o saldo atual da carteira em uma consulta posterior. Uma repetição com a mesma chave e os mesmos dados de negócio devolve o resultado persistido, com `idempotentReplay: true`. Reutilizar a chave com dados diferentes retorna `409 IDEMPOTENCY_CONFLICT`; reutilizar a identidade externa do provedor com outra chave retorna `409 DUPLICATE_TRANSACTION`.

O hash persistido é SHA-256 em hexadecimal minúsculo do JSON compacto com chaves ordenadas recursivamente. Inclui os campos de negócio validados; o valor monetário é normalizado para duas casas decimais. O header e metadados HTTP são excluídos. Transações de negócio não aplicáveis, como BET sem saldo suficiente, são persistidas como `REJECTED` com o saldo inalterado; carteira inexistente retorna `404 WALLET_NOT_FOUND`.

`REFUND` exige referência a uma aposta processada e permite devoluções parciais até o valor líquido da aposta. `ROLLBACK` reverte integralmente uma transação elegível, no máximo uma vez. Essas regras e os campos completos das respostas estão detalhados na [spec da API de wagering](docs/specs/0004-wagering-transactions-api/index.md).

### Consultar ledger e reconciliar

O cursor de `GET /wallets/:walletId/ledger` é uma posição opaca, não um token de autorização nem uma fotografia imutável do histórico. Passe o `nextCursor` da resposta como `cursor` na próxima chamada; não construa nem altere esse valor.

`POST /wallets/:walletId/reconciliation` soma os lançamentos e compara o resultado com o saldo armazenado. Uma divergência é retornada, registrada em log e contabilizada em `wallet_reconciliation_mismatches_total`; a operação **não** corrige o saldo ou altera o ledger.

### Health checks

`/health/live` não verifica dependências. `/health/ready` verifica PostgreSQL e tenta obter atributos da fila SQS configurada. Defina `AWS_REGION` e `SQS_QUEUE_URL` e configure as credenciais AWS com permissão `sqs:GetQueueAttributes`; `SQS_ENDPOINT` pode apontar para um serviço compatível local.

Embora a checagem de prontidão inclua SQS, **não há produtor, consumidor ou processamento de mensagens SQS implementado**. Sem URL ou acesso à fila, a aplicação pode iniciar e atender rotas, mas `/health/ready` retorna `503`.

## Consistência e limites conhecidos

- Valores monetários são strings na API, `numeric(18,2)` no PostgreSQL e calculados com decimal exato.
- Transações de wagering bloqueiam a carteira durante a atualização; constraints de unicidade e saldo não negativo no banco protegem contra duplicidade e saldo negativo.
- Carteira, transação e lançamento do ledger são gravados atomicamente no PostgreSQL. O ledger impede atualização e exclusão de lançamentos.
- Idempotência é persistida no PostgreSQL; o comportamento não depende de memória local nem de uma única instância da aplicação.
- O fluxo atual é síncrono. Não há publicação de eventos, outbox transacional, retries de mensagens ou DLQ.
- Não há autenticação de provedor, autorização/propriedade de carteira ou rate limiting. Os `providerId` recebidos são declarações do cliente, não identidades verificadas.
- `GET /metrics` e os health checks também não têm autenticação. Restrinja o acesso a toda a aplicação por rede até existir uma camada de segurança apropriada.
- As métricas de contagem de DLQ e de atraso do outbox não existem porque esses componentes ainda não foram implementados. Tracing distribuído e dashboards também não estão configurados.

## Observabilidade implementada

`GET /metrics` expõe, entre outras, estas métricas:

- `wagering_transactions_total{status}`: novas transações por status final.
- `wagering_duplicate_transactions_total`: identidade de transação externa duplicada.
- `wagering_idempotency_conflicts_total`: chave reutilizada com payload diferente.
- `wagering_transaction_retries_total`: replays idempotentes correspondentes; não representa retry automático de mensagem.
- `wagering_lock_conflicts_total`: deadlocks, conflitos de lock e falhas de serialização do PostgreSQL.
- `wagering_transaction_processing_duration_seconds`: duração do processamento síncrono.
- `wallet_reconciliation_mismatches_total`: divergências encontradas na reconciliação.

Os logs são JSON, incluem `correlationId`, `messageId`, `transactionId`, `walletId` e `providerId` (nulos quando não aplicáveis), e não devem incluir corpo da requisição, valores monetários ou chave de idempotência. A aplicação aceita `x-correlation-id` seguro ou gera um UUID e o devolve no header da resposta. `messageId` permanece nulo enquanto não houver consumo de mensagens.

## Testes e validação

Testes unitários:

```bash
bun run test
```

Testes de integração usam PostgreSQL descartável via Docker, sem volume persistente:

```bash
bun run test:integration:db:up
bun run test:integration
bun run test:integration:db:down
```

`bun run test:integration` executa a build e a suíte PostgreSQL. Na última execução, a build passou e **35 testes de integração em 4 arquivos passaram**. Testes unitários isolados usam mocks quando apropriado; os testes de integração verificam persistência e concorrência contra PostgreSQL real.

## Próximos passos antes de produção

1. Implementar autenticação de provedores, autorização/escopo por identidade, propriedade de carteira e rate limiting.
2. Se o desafio exigir fluxo assíncrono, projetar e implementar a integração SQS: publicação confiável após commit (por exemplo, via outbox), consumidor idempotente, retry/backoff e DLQ.
3. Adicionar métricas e alertas de outbox/DLQ quando os respectivos componentes existirem.
4. Definir políticas operacionais de migrations, retenção/auditoria, backups, recuperação e monitoramento.

Não há promessa de que a implementação esteja pronta para produção: o escopo entregue é um MVP síncrono para demonstração e avaliação técnica.
