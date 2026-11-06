# 0002. Wallet creation API

**Date**: 2026-11-06
**Status**: Implemented

## Summary

`POST /wallets` creates a BRL wallet from a player UUID and an initial amount. A positive amount is recorded as an `OPENING` transaction and a credit in the immutable ledger in the same SQL transaction, while zero creates only the wallet. The route returns the normalized balance and uses one error format. Authentication and request limits remain out of challenge scope, so the route must not be exposed publicly as is.

## Context

> ⚠️ Premise note: The challenge allows this route to omit authentication and request limits, but it creates wallets with monetary balances. Exposing it publicly without either permits arbitrary wallet creation and resource abuse. This spec limits that choice to the challenge and requires authentication and request limits before public exposure.

At the time this spec was written, the project had wallet, transaction, and ledger entities, repository contracts, and a unit of work, but its HTTP surface contained only `GET /`. The wallet identifier was supplied internally, and the persistence schema stored the wallet player identifier as text. Provider fields on a wager transaction were required even when there was no provider event.

The endpoint accepts a player identifier and an initial BRL amount. The challenge requires wallet creation to leave a consistent balance, with an auditable opening record for positive balances. No specific legal compliance or retention requirement was provided for this challenge.

## Requirements

**User stories**:

* As an API client, I want to create a wallet for a player so that the wagering service can keep that player's balance.
* As the wagering service, I want positive initial balances recorded with an opening transaction and ledger entry so that the balance has an immutable audit record.

**Acceptance criteria**:

* **AC-1**: `POST /wallets` accepts `playerId` as a UUID and `initialBalance` as an object with a decimal string `amount` and `currency`. It accepts only `BRL`, allows zero, and follows the existing `Money` format. It rejects negative values, leading zeroes other than zero itself, more than two decimal places, values above `9999999999999999.99`, invalid UUIDs, nonstring amounts, and unknown fields with HTTP `400`.
* **AC-2**: A valid request creates a wallet with a server generated UUID, the requested player, the normalized balance, BRL currency, and initial version `1`. It returns HTTP `201` with `id`, `playerId`, `balance` as a two decimal string, and `version`.
* **AC-3**: A zero initial balance creates only the wallet. It creates no `OPENING` transaction and no ledger entry.
* **AC-4**: A positive initial balance creates a `PROCESSED` `OPENING` transaction and exactly one `OPENING` ledger entry. The transaction amount and ledger amount equal the initial amount; the ledger direction is `CREDIT`, the starting balance is zero, and the ending balance equals the initial amount. Provider fields are null for this internal transaction and are not filled with placeholder values.
* **AC-5**: Wallet, opening transaction, and ledger entry writes use the same database transaction. If any write fails, all writes roll back and no partial wallet is left behind.
* **AC-6**: A wallet already exists conflict, including concurrent attempts for the same player and currency, returns HTTP `409` with code `WALLET_ALREADY_EXISTS`. Only the wallet uniqueness constraint is translated this way.
* **AC-7**: Errors use the shape `{ "statusCode": number, "code": string, "message": string }`, with messages in Portuguese. Validation errors use HTTP `400` and code `VALIDATION_ERROR`; known domain errors keep their domain code; unexpected errors return HTTP `500` and code `INTERNAL_SERVER_ERROR`, are logged on the server, and do not expose internal details.
* **AC-8**: The README states that this challenge endpoint has no authentication or request limits and is not safe for public exposure. It identifies authentication and request limits as work required before public deployment.

## Options considered

### Option 1: Create only the wallet

Store the initial amount directly on the wallet and do not create an opening transaction or ledger entry.

**Pros**:

* The smallest change, with the fewest writes.
* Simple to explain and test.

**Cons**:

* A positive balance has no immutable record explaining its origin.
* It does not meet the agreed ledger requirement.

### Option 2: Create the wallet and opening records atomically

Create the wallet for every valid request. For a positive amount, also create a processed opening transaction and its ledger entry in the same SQL transaction.

**Pros**:

* The wallet balance and its audit record are consistent as soon as the request succeeds.
* The existing unit of work already provides the transaction boundary.
* Zero balance remains a simple wallet creation without a meaningless transaction.

**Cons**:

* The domain model and schema need a focused change for internal opening transactions.
* The request flow has more records and rules to test.

### Option 3: Create opening records asynchronously

Create the wallet first, then use an event and background worker to record the opening transaction and ledger entry.

**Pros**:

* Separates wallet creation from later processing.
* Could suit a future workflow that calls an external provider.

**Cons**:

* The wallet could temporarily show a balance without its ledger record.
* It adds a queue, worker, retry behavior, and eventual consistency without an external call in this feature.

## Decision

**Chosen option**: Option 2: Create the wallet and opening records atomically.

Use the existing NestJS and MikroORM stack, and persist the wallet and positive opening records through the existing unit of work. Validate requests with NestJS `ValidationPipe`, `class-validator`, and `class-transformer`. Use a global NestJS exception filter for the shared error shape, and map only the named wallet uniqueness constraint to a conflict.

## Rationale

The feature already has a PostgreSQL unit of work, repository contracts, and immutable ledger entries. Using them avoids a second persistence path and keeps the response from succeeding with only part of its financial record. A queue would add operational work and temporary inconsistency without an external system to call.

The selected input format keeps decimal amounts as text, matching the domain `Money` value and avoiding floating point conversion. A UUID stored in PostgreSQL matches the confirmed request format. The existing unique constraint remains the final guard when two requests race.

The choice to omit authentication and request limits is for the technical challenge only. This is not a safe production configuration. The README must make that boundary clear, and public deployment requires both protections.

## Feature design

**Data model sketch**:

| Entity | Fields and rules |
|---|---|
| `Wallet` | `id` UUID primary key; `player_id` UUID required; `balance_amount` `numeric(18,2)` required and nonnegative; `balance_currency` `varchar(3)` required and `BRL` for this endpoint; `version` integer starting at `1`; `created_at` and `updated_at` timestamps. Unique constraint on `player_id` and `balance_currency`. |
| `WagerTransaction` | Created only for a positive initial amount. `id` UUID primary key; `wallet_id` UUID foreign key; `kind` `OPENING`; amount equal to the initial amount and currency BRL; `status` `PROCESSED`; unique `idempotency_key`; `payload_hash`; creation, update, and processing timestamps. Provider fields `provider_id`, `external_transaction_id`, `player_id`, `round_id`, and `game_id` may be null for `OPENING` and remain required for other kinds. The transaction `player_id` remains provider text; only `wallets.player_id` changes to UUID. Existing reference and failure fields remain nullable where already defined. |
| `WalletLedgerEntry` | Created only for a positive initial amount. `id` UUID primary key; `wallet_id` and `transaction_id` foreign keys; type `OPENING`; direction `CREDIT`; positive amount in BRL; balance before is zero and balance after equals the initial amount; creation timestamp. Keep the existing uniqueness constraint and immutability rule. |

One wallet can have many transactions and many ledger entries. A processed `OPENING` has exactly one ledger entry. A zero balance has no transaction or ledger entry. The ledger entry is immutable.

The wallet `player_id` column changes from text to PostgreSQL UUID. Use a new forward migration rather than rewriting the existing migration. The migration must preserve rows and fail visibly if an existing player identifier cannot be converted to UUID. Provider fields become nullable for `OPENING`; a database check and domain validation keep them required for other transaction kinds.

**State transitions**:

* A positive opening is persisted directly as `PROCESSED`; it has no persisted pending state.
* A zero balance creates no transaction state.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/wallets` | `POST` | `playerId: UUID`; `initialBalance: { amount: string, currency: "BRL" }` | `id: UUID`, `playerId: UUID`, `balance: string`, `version: number` | None for the challenge | `400 VALIDATION_ERROR`; `409 WALLET_ALREADY_EXISTS`; `500 INTERNAL_SERVER_ERROR` |

Example request:

```json
{
  "playerId": "4e7c7d27-2b9f-45cc-8ac3-11843083b2fc",
  "initialBalance": {
    "amount": "25.00",
    "currency": "BRL"
  }
}
```

Example response:

```json
{
  "id": "b9fcce4c-566f-4965-8140-f0222460fe12",
  "playerId": "4e7c7d27-2b9f-45cc-8ac3-11843083b2fc",
  "balance": "25.00",
  "version": 1
}
```

The request amount is a decimal string in the existing `Money` format. Trim surrounding whitespace, allow at most two fractional digits and sixteen integral digits, and normalize accepted amounts to two decimal places. Do not implicitly convert JSON numbers to strings. Reject extra properties rather than silently discarding them.

Example error response:

```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "O campo playerId deve ser um UUID válido."
}
```

When validation finds multiple errors, join their Portuguese messages into the same string.

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| Create wallet | `playerId` | Request body `playerId`, validated as UUID |
| Create wallet | Currency and normalized balance | Request `initialBalance`; currency must be `BRL`; amount is validated and normalized by `Money` |
| Create wallet | Wallet identifier and version | UUID from Node.js `crypto.randomUUID()`; initial version from the wallet model, value `1` |
| Create opening transaction | Identifier, status, idempotency key, and payload hash | UUID from `crypto.randomUUID()`; constant `PROCESSED`; `wallet-opening:<walletId>`; SHA-256 of compact JSON with fields in this order: `walletId`, `kind`, normalized `amount`, `currency` |
| Create ledger entry | Identifier and balances | UUID from `crypto.randomUUID()`; amount from the normalized initial balance; before is zero; after is the initial balance |
| Return success | `id`, `playerId`, `balance`, and `version` | Persisted wallet fields, with `balance` serialized as a two decimal string |
| Return error | Status, code, and message | Validation result, known domain error, the named wallet uniqueness constraint, or generic unexpected error mapping |

**Key invariants**:

* A player has at most one wallet per currency.
* This endpoint accepts only BRL, and its maximum amount is `9999999999999999.99`.
* For a positive opening, the wallet balance, transaction amount, ledger amount, and ledger ending balance all equal the initial amount.
* A positive opening, its wallet, and its single ledger entry commit or roll back together.
* The opening idempotency key is `wallet-opening:<walletId>`. Its payload hash is lowercase hexadecimal SHA-256 of the fixed field order specified above.
* Provider values are absent for an internal opening and required for other transaction kinds.
* No client supplied provider identifiers or placeholder provider values are used to create an opening.

**Security model**:

The challenge endpoint has no authentication or ownership check. A caller can request a wallet for any valid player UUID, and there is no request limit. This is only acceptable for the technical challenge and local evaluation. Do not expose the route publicly until a NestJS guard and request limiting are added. No specific compliance scope was provided.

**Critical test scenarios**:

* Happy path: positive BRL balance returns `201` and persists the wallet, processed opening, and balanced credit in PostgreSQL, verifies **AC-2**, **AC-4**, and **AC-5**.
* Zero balance: returns `201` with balance `"0.00"` and persists only a wallet, verifies **AC-2** and **AC-3**.
* Failure case: a write failure after wallet creation rolls back all three records and returns a sanitized `500`, verifies **AC-5** and **AC-7**.
* Validation and duplicate cases: malformed input returns the uniform `400`; sequential or concurrent duplicate creation returns `409` without a second wallet, verifies **AC-1**, **AC-6**, and **AC-7**.
* Auth and permission: a request without credentials is accepted for challenge scope, and the README warns against public exposure without authentication and request limits, verifies **AC-8**.

## Build plan

The project uses a Tracer Bullet approach, connecting a small working path through each layer before adding the edge handling. One schema migration is appropriate because the wallet, opening transaction, and ledger form one data model.

1. Add domain support for `OPENING`, the opening ledger type, optional provider data for openings, and the shared amount maximum. Add one forward migration for the UUID player identifier and opening constraints. Preserve other transaction requirements. Satisfies **AC-3**, **AC-4**, and **AC-5**.
2. Add a wallet feature module, controller, and application service. Connect them to the existing unit of work. Generate UUIDs with Node.js `crypto.randomUUID()`, create only a wallet for zero, and create all three records atomically for positive amounts. Return the agreed `201` response. Satisfies **AC-2**, **AC-3**, **AC-4**, and **AC-5**.
3. Add `class-validator` and `class-transformer` as runtime dependencies, then add request DTO validation and the global exception filter. Use `ValidationPipe` with nested validation, whitelist, rejection of unknown fields, and no implicit numeric conversion. Map only the wallet uniqueness constraint to `409`; log unexpected failures and return the agreed generic `500` body. Satisfies **AC-1**, **AC-6**, and **AC-7**.
4. Add unit and request level tests, including integration tests against disposable PostgreSQL for atomicity and concurrent duplicate creation. Update the README with the request, response, error shape, and challenge only security boundary. Satisfies **AC-1** through **AC-8**.

## Consequences

**Positive**:

* A successful response always represents a complete wallet state and, when needed, its ledger record.
* The route uses the existing persistence and transaction patterns.
* Validation failures have a stable response shape and do not reach the database.

**Negative / tradeoffs**:

* The public route has no identity or call limit, so it is unsafe for public deployment.
* A duplicate request returns `409` rather than the original success response.
* The player identifier migration can fail if existing values are not UUIDs.
* The opening flow requires changes to the domain entities and additional tests.

**Neutral**:

* Add `class-validator` and `class-transformer` as runtime dependencies.
* The endpoint is synchronous and depends on PostgreSQL availability.
* No new environment variables or external credentials are required.

## Follow-up

* Before public exposure, add authentication and request limiting.
