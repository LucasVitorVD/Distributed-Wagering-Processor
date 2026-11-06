# 0004. Wagering transaction API

**Date**: 2026-11-06
**Status**: In Progress

## Summary

These routes let a provider submit a wagering transaction and let a game service look it up later. Each POST uses a required idempotency key (a value that makes retries return the saved result) and records the wallet change, result balance, and ledger entry together. The POST returns only the transaction ID, status, result balance, and replay indicator, so retries return the original result even after later wallet changes.

## Requirements

**User stories**:

* As a provider, I want to submit a wagering transaction so that its outcome and any balance change are recorded once.
* As a game service, I want to retrieve a transaction by its internal ID or provider identity so that I can inspect its result.

**Acceptance criteria**:

* **AC-1**: `GET /wagering/transactions/:transactionId` accepts a UUID and returns the agreed transaction representation. A malformed UUID returns `400 VALIDATION_ERROR`; a valid but unknown UUID returns `404 WAGER_TRANSACTION_NOT_FOUND`.
* **AC-2**: `GET /providers/:providerId/wagering/transactions/:externalTransactionId` finds the transaction by the exact provider and external transaction IDs and returns the same representation as AC-1. Invalid path values return `400 VALIDATION_ERROR`; a valid but unknown pair returns `404 WAGER_TRANSACTION_NOT_FOUND`.
* **AC-3**: `POST /wagering/transactions` requires the `Idempotency-Key` header and validates the agreed body. Invalid headers, malformed fields, unsupported kinds, nonpositive or invalid BRL amounts, invalid reference use, or extra fields return `400 VALIDATION_ERROR` without writing a transaction or reserving the key.
* **AC-4**: A valid POST processes synchronously. A successful transaction, its result balance snapshot, wallet balance change when applicable, and ledger entry when applicable commit together through one unit of work. A failure during persistence rolls back all writes.
* **AC-5**: BET debits the wallet, WIN credits it, LOSS changes no balance and creates no ledger entry, REFUND credits a processed BET, and ROLLBACK reverses a processed BET, WIN, or REFUND. `OPENING` is not accepted by this endpoint.
* **AC-6**: REFUND requires a processed BET from the same provider, player, and wallet. Partial refunds are allowed, but the net refunded amount cannot exceed the original BET. A ROLLBACK is an exact, integral reversal of one processed transaction from the same provider, player, and wallet, and a transaction can be rolled back at most once. A BET with any net refund cannot also receive a full ROLLBACK. Rolling back a REFUND restores that amount to the BET's remaining refund allowance.
* **AC-7**: A valid business operation that cannot be applied, such as insufficient balance or an invalid or unavailable reference, is persisted as `REJECTED` when a wallet exists. It changes no balance and creates no ledger entry. The API returns `200` with `transactionId`, `status`, the unchanged balance snapshot, and `idempotentReplay: false`. Repeating the same key and payload replays that rejection and its saved balance. An unknown wallet returns `404 WALLET_NOT_FOUND` and does not reserve the key or create a transaction.
* **AC-8**: The `payloadHash` is lowercase hexadecimal SHA-256 of compact JSON with recursively sorted object keys. It includes `providerId`, `externalTransactionId`, `playerId`, `roundId`, `gameId`, `kind`, normalized `amount.amount`, `amount.currency`, and `referenceExternalTransactionId` when applicable. It excludes `Idempotency-Key` and transport metadata. Amounts are normalized to two decimal places before hashing. Other business strings retain their exact validated values.
* **AC-9**: The `Idempotency-Key` is globally unique, required, nonempty, at most 512 characters, and is the source of truth. The recommended caller value is `{providerId}:{externalTransactionId}`. The same key and same hash returns the stored `transactionId`, `status`, and result balance with `idempotentReplay: true`. The first request returns those same fields with `idempotentReplay: false`. Reusing a key with a different hash returns `409 IDEMPOTENCY_CONFLICT`, never a replay.
* **AC-10**: Reusing the same provider and external transaction IDs with a different idempotency key returns `409 DUPLICATE_TRANSACTION`, never a replay. Concurrent identical requests apply effects at most once; the other request receives the stored outcome as a replay. Concurrent requests with the same key and different payloads result in one committed outcome and a conflict for the other.
* **AC-11**: GET responses expose the agreed transaction fields but never expose `idempotencyKey` or `payloadHash`. POST returns exactly `transactionId`, `status`, `balance: { amount, currency }`, and `idempotentReplay`. `balance.amount` is a JSON string formatted to two decimal places. For transactions created after the migration, the balance is the saved balance immediately after the transaction outcome, or the unchanged balance for a rejection. This is not the wallet's later current balance. For older transactions, the migration provides a compatibility snapshot that may not represent the historical balance.
* **AC-12**: Errors use the existing `{ "statusCode": number, "code": string, "message": string }` format. Unexpected persistence errors return a sanitized `500 INTERNAL_SERVER_ERROR`, roll back all writes, do not consume the key, and permit retry. Logs do not include request bodies, financial values, provider identifiers, or the idempotency header.
* **AC-13**: The README documents the routes, request and response examples, hash rules, and the challenge only security boundary. It states that authentication and request limiting are required before public exposure.

## Decision

**Chosen option**: Option 1, process synchronously through the current unit of work.

Use the existing domain entities, repository contracts, row lock, uniqueness constraints, and unit of work. Compute the hash from the validated business payload, persist terminal business rejections as `REJECTED`, and use the persisted transaction as the replay result. Add a result balance snapshot to each wagering transaction so the compact POST result remains stable across retries. Do not add a queue or separate idempotency table.

**Implementation skills**: `nestjs-best-practices` (`kadajett/agent-nestjs-skills`, `.agents/skills/nestjs-best-practices/`) · `nestjs-patterns` (`affaan-m/ecc`, `.agents/skills/nestjs-patterns/`) · `class-validator` (`claude-dev-suite/claude-dev-suite`, `.agents/skills/class-validator/`)

## Feature design

**Data model sketch**:

No new entity or table is required. Add `resulting_balance_amount numeric(18,2)` and `resulting_balance_currency varchar(3)` to `wager_transactions`. Both values are saved for every new POST outcome, including LOSS and REJECTED. Existing rows are backfilled during the migration. When an older transaction has a ledger entry, use its `balance_after_amount` and `balance_after_currency`; otherwise use the associated wallet's `balance_amount` and `balance_currency` at migration time.

| Entity | Fields and constraints | Relationships |
|---|---|---|
| `Wallet` | UUID `id` and `playerId`; `numeric(18,2)` balance; currency; version and timestamps. Unique by player and currency. Balance is nonnegative. | One wallet has many wagering transactions and ledger entries. |
| `WagerTransaction` | UUID `id`; wallet; kind; positive amount and currency; status; result balance amount and currency; globally unique `idempotencyKey`; lowercase SHA-256 `payloadHash`; provider, external transaction, player, round, and game IDs; optional external and internal reference; creation, update, and optional processing timestamps; optional failure code. Provider and external transaction ID are unique together. | Each transaction belongs to one wallet and may reference one prior transaction. A prior transaction may be referenced by multiple REFUNDs, but at most one ROLLBACK. |
| `WalletLedgerEntry` | UUID `id`; wallet and transaction IDs; type, direction, positive amount, before and after balances, currencies, and creation time. Immutable after insertion. Unique by wallet and transaction. | Each entry belongs to one wallet and one transaction. A transaction has at most one entry. LOSS and REJECTED transactions have none. |

`OPENING` remains an internal wallet creation operation. This API accepts `BET`, `WIN`, `LOSS`, `REFUND`, and `ROLLBACK`.

**State transitions**:

* A new transaction starts as `PENDING` inside the unit of work.
* A successful transaction becomes `PROCESSED` before commit.
* A valid business rejection becomes `REJECTED` before commit.
* No `PENDING` or `PENDING_REFERENCE` transaction is committed by this synchronous flow. A technical or persistence failure rolls back the transaction instead of persisting `FAILED`.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/wagering/transactions/:transactionId` | `GET` | `transactionId: UUID` | Transaction representation | None for the challenge | `400 VALIDATION_ERROR`; `404 WAGER_TRANSACTION_NOT_FOUND`; `500 INTERNAL_SERVER_ERROR` |
| `/providers/:providerId/wagering/transactions/:externalTransactionId` | `GET` | `providerId` and `externalTransactionId`, required text up to 255 characters | Same transaction representation | None for the challenge | `400 VALIDATION_ERROR`; `404 WAGER_TRANSACTION_NOT_FOUND`; `500 INTERNAL_SERVER_ERROR` |
| `/wagering/transactions` | `POST` | Required `Idempotency-Key` header up to 512 characters; body fields below | Exactly `transactionId`, `status`, `balance`, and `idempotentReplay` | None for the challenge | `400 VALIDATION_ERROR`; `404 WALLET_NOT_FOUND`; `409 IDEMPOTENCY_CONFLICT` or `DUPLICATE_TRANSACTION`; `500 INTERNAL_SERVER_ERROR` |

The POST body contains `providerId`, `externalTransactionId`, `playerId`, `roundId`, `gameId`, `kind`, `amount: { amount: string, currency: "BRL" }`, and `referenceExternalTransactionId` only for REFUND or ROLLBACK. `playerId` is a UUID. Other IDs are nonempty text up to 255 characters and are preserved exactly. The amount is a positive decimal string with at most two fractional digits and the existing Money maximum. Unknown fields are rejected.

Both GET routes return the transaction fields `id`, `walletId`, `providerId`, `externalTransactionId`, `playerId`, `roundId`, `gameId`, `kind`, `amount`, `status`, `referenceExternalTransactionId`, `referenceTransactionId`, `failureCode`, `createdAt`, and `processedAt`. Nullable values are returned as `null`. The POST response is deliberately smaller: `transactionId` maps to the internal transaction ID, `status` is the committed outcome, `balance` is the saved post outcome balance, and `idempotentReplay` indicates whether this is a replay. It returns HTTP `200` for new outcomes and replays, including persisted business rejections.

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| Resolve a wallet | Wallet ID | `Wallet` lookup by validated `playerId` and `BRL`, inside the unit of work and row lock |
| Identify a request for replay | Idempotency key | Required `Idempotency-Key` header |
| Compute the payload hash | Business fields and normalized amount | Validated body, with amount normalized by the existing `Money` rules |
| Return the POST transaction ID | Internal transaction ID | `WagerTransaction.id` |
| Return the POST status | Committed transaction outcome | Persisted `WagerTransaction.status` |
| Return the POST balance | Outcome balance | Snapshot stored on the transaction in the same unit of work; current wallet balance after applying a successful operation, or unchanged wallet balance for a rejection |
| Return the POST replay indicator | Boolean | Whether an existing matching idempotency key and payload hash was found |
| Return an internal transaction lookup | Transaction fields and nullable values | Matching `WagerTransaction` columns and related wallet ID |
| Return a provider transaction lookup | Transaction fields and nullable values | `WagerTransaction` matching the exact provider and external transaction IDs |
| Apply a transaction | New wallet balance and ledger direction | Existing transaction kind rules, amount, locked wallet balance, and referenced transaction when required |
| Return a ledger entry | Amount, direction, before and after balances | The committed `WalletLedgerEntry` |
| Return transaction status and failure code | Status and optional reason | Persisted `WagerTransaction` state |
| Return replay indicator | Boolean | Whether an existing matching idempotency key and payload hash was found |
| Return an error | Status, code, and message | DTO validation, wallet or transaction lookup, domain outcome, uniqueness conflict, or the global exception filter |

**Key invariants**:

* A request key identifies one business payload globally. The key is not part of the payload hash.
* Canonical JSON uses recursively sorted keys, compact JSON encoding, UTF-8 bytes, and SHA-256. The digest is lowercase hexadecimal.
* The amount is normalized to two decimal places before hashing. Other business strings are not trimmed or case folded.
* A matching key and hash returns the stored transaction ID, status, and result balance. A matching key with a different hash is always a conflict.
* The provider and external transaction ID pair is unique even when the caller uses another key.
* The wallet row is locked before checking balance or applying a transaction. Wallet, transaction, result balance snapshot, and ledger writes use one unit of work.
* The POST balance is a historical outcome value, not a live wallet query. Replays return the original snapshot even after later transactions change the wallet.
* A valid `LOSS` is recorded as `PROCESSED` without changing the balance or creating a ledger entry.
* A business rejection is stored as `REJECTED` only when there is a wallet to reference. It does not change the balance or create a ledger entry.
* Invalid requests, unknown wallets, and unexpected infrastructure failures do not reserve the key.
* Ledger entries remain insert only. No route updates or deletes an existing ledger entry.

**Security model**:

The challenge routes do not authenticate callers, verify ownership, or apply request limits. POST `providerId` is an unverified body value. GET path identifiers are lookup values, not credentials. The routes are not safe for public exposure. Add provider authentication, resource scoping, and request limiting before public deployment. Do not log request bodies, amounts, provider identifiers, or idempotency keys. No specific compliance scope was provided.

**Configuration required**:

None.

**Critical test scenarios**:

* Lookup by internal ID returns the same transaction projection as lookup by provider identity, verifies **AC-1**, **AC-2**, and **AC-11**.
* Malformed paths return `400`, and valid missing transaction identifiers return `404`, verifies **AC-1** and **AC-2**.
* Invalid POST body or missing, empty, or oversized key returns `400` without persistence, verifies **AC-3** and **AC-9**.
* BET debits and records one ledger entry atomically; WIN and REFUND credit; LOSS creates no ledger entry; ROLLBACK applies the inverse direction, verifies **AC-4** and **AC-5**.
* Insufficient balance and invalid references persist a `REJECTED` transaction without a balance change or ledger entry. Missing wallet returns `404` and leaves the key free, verifies **AC-7**.
* Partial refunds cannot exceed a BET. A full rollback cannot be combined with a net refund. Rolling back a REFUND restores its amount to the remaining refund allowance, verifies **AC-6**.
* Same key and same hash return the stored transaction ID, status, and balance with `idempotentReplay: true`, including after another transaction changes the wallet. Same key with a different hash returns `409 IDEMPOTENCY_CONFLICT`. Same provider identity with another key returns `409 DUPLICATE_TRANSACTION`, verifies **AC-8**, **AC-9**, and **AC-10**.
* Concurrent matching requests apply one balance effect and one ledger entry. Concurrent key conflicts produce one outcome and one conflict. Persistence failures roll back and allow retry, verifies **AC-4**, **AC-9**, **AC-10**, and **AC-12**.
* GET responses omit internal idempotency values. POST returns exactly the four agreed fields and the saved outcome balance. Logs omit financial and provider data. README warns against public exposure, verifies **AC-11**, **AC-12**, and **AC-13**.

## Build plan

The project uses a Tracer Bullet approach. First connect one safe POST path through validation, the application service, the existing unit of work, and PostgreSQL. Then extend the same path to every transaction kind and add both read routes.

1. [x] Add repository lookup by internal transaction ID and any reference query needed by the existing transaction repository. Add both GET routes and the shared response projection, with unit and PostgreSQL tests. Do not return idempotency keys or hashes. Satisfies **AC-1**, **AC-2**, and **AC-11**.
2. [x] Connect a complete synchronous BET POST path through a DTO, application service, wallet row lock, transaction and ledger persistence, and one unit of work. Require the header and compute the canonical hash from the first implementation. Satisfies **AC-3**, **AC-4**, **AC-8**, and **AC-9**.
3. [x] Extend the application service to WIN, LOSS, REFUND, and ROLLBACK. Add same provider and wallet reference checks, cumulative refund limits, rollback limits, and persisted `REJECTED` outcomes. Satisfies **AC-5**, **AC-6**, and **AC-7**.
4. [x] Handle uniqueness races by rolling back before rereading the committed key or provider identity. Add conflict mapping, response replay behavior, transaction failure rollback, and concurrent PostgreSQL tests. Satisfies **AC-8**, **AC-9**, **AC-10**, and **AC-12**.
5. [x] Add focused unit and HTTP tests for validation, error responses, and safe logs. Update the README with examples, hash details, and the security boundary. Satisfies **AC-3**, **AC-11**, **AC-12**, and **AC-13**.
6. [x] Persist each POST outcome balance with its transaction, return the exact compact response shape, and verify replay returns the original balance after later wallet changes. Add and apply a migration for the snapshot fields. Satisfies **AC-4**, **AC-7**, **AC-9**, and **AC-11**.

## Consequences

**Positive**:

* A committed response reflects one atomic wallet, transaction, and ledger outcome.
* Retries use the persisted transaction instead of repeating financial effects.
* Replays preserve the balance that belonged to the original outcome.

**Negative / tradeoffs**:

* A busy wallet serializes transactions while its row lock is held.
* The challenge API remains unsafe for public exposure until authentication and request limiting are added.
* The hash format becomes a durable contract. A future change to its fields or normalization needs deliberate compatibility handling.
* Business rejections consume an idempotency key when a wallet exists, while a missing wallet does not reserve it.

**Neutral**:

* A schema migration adds the outcome balance snapshot. No new environment variable, queue, or external provider is added.
* Requests are synchronous and depend on PostgreSQL availability.

## Rationale

Reasoning and options: see [rationale.md](./rationale.md).

## Migration plan

**Strategy**: Big bang for this challenge service, because these routes are not publicly exposed and have no authenticated production callers. Stop all application instances that can write wagering transactions while applying the migration and deploying the new code.

**Phases**:
1. Stop the application writers.
2. Add nullable result balance columns. Backfill each transaction from its ledger entry's `balance_after_amount` and `balance_after_currency` when present; otherwise use the related wallet's `balance_amount` and `balance_currency` at migration time. Then add non null and consistency constraints.
3. Deploy the application code that records an exact snapshot for every new POST outcome, returns it on the compact response and every replay, and restart the writers.

**Rollback**: Stop the writers, revert the application code, then revert the migration. Dropping the snapshot columns removes the added response data; the existing transaction and ledger data remain.

**Risks**: Older transactions without a ledger entry cannot reveal their exact historical balance. The migration uses their wallet balance at migration time, so that compatibility value is not a reconstruction of the original request time. Writers must remain stopped until the new version is active, otherwise an older instance could insert a transaction without the required snapshot. Every outcome created after the new code is deployed has an exact stable snapshot.

## Follow-up

* [ ] Add `nestjs-best-practices`, `nestjs-patterns`, and `class-validator` pointers to root `AGENTS.md`; these relevant conventions are installed under `.agents/skills/` but are not listed in the project context.
* [ ] Design provider authentication, ownership checks, and request limiting before public deployment.
