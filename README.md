<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ bun install
```

## Compile and run the project

```bash
# development
$ bun run start

# watch mode
$ bun run start:dev

# production mode
$ bun run start:prod
```

## Run tests

```bash
# unit tests
$ bun run test

# e2e tests
$ bun run test:e2e

# test coverage
$ bun run test:cov
```

## Create a wallet

`POST /wallets` creates one BRL wallet for a player UUID. Send the initial amount as a decimal string:

```json
{
  "playerId": "2f986158-4ec9-4c7f-8ca1-f790a83af8df",
  "initialBalance": {
    "amount": "25.50",
    "currency": "BRL"
  }
}
```

The route returns `201 Created` with the wallet `id`, `playerId`, normalized `balance`, and `version`. A zero balance creates only the wallet. A positive balance also creates a processed `OPENING` transaction and a credit ledger entry in the same database transaction.

Example success response:

```json
{
  "id": "c04e4200-3f21-4c87-94f1-0e50032cc554",
  "playerId": "2f986158-4ec9-4c7f-8ca1-f790a83af8df",
  "balance": {
    "amount": "25.50",
    "currency": "BRL"
  },
  "version": 1
}
```

Errors use this format:

```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "O campo playerId deve ser um UUID válido."
}
```

This challenge endpoint has no authentication or request limits. It is not safe for public exposure. Add authentication and request limiting before deploying it publicly.

## Read a wallet

`GET /wallets/:walletId` returns the wallet identifier, player identifier, current balance, and version:

```json
{
  "id": "c04e4200-3f21-4c87-94f1-0e50032cc554",
  "playerId": "2f986158-4ec9-4c7f-8ca1-f790a83af8df",
  "balance": {
    "amount": "25.50",
    "currency": "BRL"
  },
  "version": 1
}
```

`GET /wallets/:walletId/ledger?limit=50` returns ledger entries from newest to oldest. The limit defaults to `50` and can be set from `1` to `100`. When another page exists, `nextCursor` contains an opaque position. Send it as the `cursor` query parameter to continue. Treat it as an opaque value.

The wallet read routes also have no authentication, wallet ownership check, or request limits. The README warning does not restrict access, so keep the service available only to challenge evaluation. Add authentication, ownership checks, and request limiting before public exposure.

## Submit and read wagering transactions

`POST /wagering/transactions` accepts `BET`, `WIN`, `LOSS`, `REFUND`, and `ROLLBACK`. `OPENING` is created only when a wallet starts with a positive balance. Send the required `Idempotency-Key` header with every request. A recommended value is `{providerId}:{externalTransactionId}`.

Example request:

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

The route returns `200 OK` with `transactionId`, `status`, the balance immediately after the outcome, and `idempotentReplay`. A first request has `idempotentReplay: false`. Repeating the same key and business data returns the saved outcome balance with `idempotentReplay: true`, even if the wallet has changed since the first request. Reusing the key with different business data returns `409 IDEMPOTENCY_CONFLICT`. Reusing the provider and external transaction IDs with another key returns `409 DUPLICATE_TRANSACTION`.

A business rejection, such as an insufficient balance or unavailable reference, is stored as `REJECTED`, with the unchanged balance, and returned with `200 OK`. An unknown player wallet returns `404 WALLET_NOT_FOUND` and does not reserve the key.

Example response:

This example assumes the wallet had `25.00 BRL` before the `5.00 BRL` BET.

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

`REFUND` and `ROLLBACK` require `referenceExternalTransactionId`. A refund must refer to a processed bet from the same provider, player, and wallet. Partial refunds are allowed, but their net total cannot exceed the bet. A rollback must exactly reverse one processed bet, win, or refund. Each transaction can be rolled back once. A bet with a net refund cannot also be rolled back.

The payload hash is lowercase hexadecimal SHA 256 of compact JSON encoded as UTF 8. Object keys are sorted recursively in ascending order. The hash includes the provider ID, external transaction ID, player ID, round ID, game ID, kind, amount, currency, and reference ID when present. The amount is normalized to two decimal places. Other business strings keep their exact validated values. The `Idempotency-Key` header and HTTP metadata are excluded.

Use `GET /wagering/transactions/:transactionId` to look up a transaction by its internal UUID. Use `GET /providers/:providerId/wagering/transactions/:externalTransactionId` to look it up by provider identity. Both GET routes return the expanded transaction details, including the wallet, provider reference, amount, and failure code. They do not return the idempotency key or payload hash.

These challenge routes do not authenticate providers, check ownership, or limit request rates. Provider IDs in requests are claimed values, not verified identities. Keep the service limited to challenge evaluation. Add provider authentication, access scope, and request limiting before public exposure.

## Reconcile a wallet

`POST /wallets/:walletId/reconciliation` compares the wallet's stored balance with the sum of its ledger entries. The ledger is read while the wallet row is locked, so another wallet transaction cannot change the balance during the check. The endpoint never changes the wallet or its ledger.

`difference` is `calculatedBalance - storedBalance`. A zero difference sets `consistent` to `true`. A mismatch returns `200 OK` with `consistent: false`, logs a warning, and increments `wallet_reconciliation_mismatches_total`. The counter is available at `GET /metrics` in Prometheus text format.

Example response:

```json
{
  "walletId": "0192f291-27dd-7d3f-8071-5f8685deef37",
  "storedBalance": { "amount": "975.00", "currency": "BRL" },
  "calculatedBalance": { "amount": "975.00", "currency": "BRL" },
  "difference": { "amount": "0.00", "currency": "BRL" },
  "consistent": true,
  "checkedEntries": 42
}
```

## Health checks

`GET /health/live` returns `200 OK` while the application process is running. It does not check dependencies.

`GET /health/ready` returns `200 OK` only when PostgreSQL accepts a query and SQS responds to `GetQueueAttributes` for the configured queue. It returns `503 Service Unavailable` when either dependency is down or the queue URL is missing.

Set `AWS_REGION` to the AWS region and `SQS_QUEUE_URL` to the queue URL. The AWS identity needs `sqs:GetQueueAttributes` for that queue. `SQS_ENDPOINT` is an optional endpoint override for local SQS-compatible services.

The AWS SDK uses its standard credential provider chain. Do not put credentials in the README or source code.

## Application metrics and logs

The application exposes Prometheus metrics at `GET /metrics`. Implemented wagering metrics are:

- `wagering_transactions_total{status}` counts new transactions by terminal status. Replays are counted separately.
- `wagering_duplicate_transactions_total` counts duplicate provider transaction identities.
- `wagering_idempotency_conflicts_total` counts idempotency keys reused with a different payload.
- `wagering_transaction_retries_total` counts matching idempotent replays.
- `wagering_lock_conflicts_total` counts PostgreSQL deadlocks, unavailable locks, and serialization failures.
- `wagering_transaction_processing_duration_seconds` measures synchronous transaction request processing.
- `wallet_reconciliation_mismatches_total` counts inconsistent wallet reconciliations.

Application logs are one JSON object per line. Each record includes `correlationId`, `messageId`, `transactionId`, `walletId`, and `providerId`; fields that do not apply are `null`. HTTP requests accept a safe `x-correlation-id` value or receive a generated UUID, returned in the response header. `messageId` remains `null` because the current service does not consume queue messages. Logs avoid request bodies, monetary amounts, and idempotency keys.

DLQ message counts and outbox lag are not implemented because the project has no queue consumer, dead letter queue, or outbox. OpenTelemetry export and dashboards are also not configured.

## PostgreSQL integration tests

Start the disposable PostgreSQL service, run the integration tests, then remove the service and its data:

```bash
$ bun run test:integration:db:up
$ bun run test:integration
$ bun run test:integration:db:down
```

The test database uses port `5434` by default and has no persistent volume.

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ bun install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

To add it to this project, run this and approve the code it prints at [observe.nestjs.com/link](https://observe.nestjs.com/link) - signing up for free if you have no account:

```bash
$ npx @nestjs/observe link
```

It installs `@nestjs/observe`, wires it into `AppModule` and `main.ts`, and writes the app key and secret into `.env`, which every `nest start` script (`start`, `start:dev`, `start:debug`) then loads. In production, set `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` in the environment instead.

Or do it by hand:

```bash
$ bun install @nestjs/observe
```

Then follow the [setup guide](https://docs.nestjs.com/observability/sdk) - it takes a single import and an app key.

The free plan needs no payment details and covers 300,000 events a month. You can also browse the [live demo](https://www.observe-demo.nestjs.com/dashboard) first - the whole dashboard over a busy service's data, with nothing to install.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observe](https://observe.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
