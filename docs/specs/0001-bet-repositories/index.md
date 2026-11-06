# 0001. Repositories for BET processing

**Date**: 2026-11-05
**Status**: Implemented

## Summary

This decision defines how the application reads and writes wallets, wager transactions, and ledger entries. Domain contracts keep business code separate from MikroORM, while one transaction scope keeps related database changes together. A wallet row lock and database constraints are used by the implemented synchronous wagering API to prevent concurrent balance updates and duplicate effects.

## Requirements

**User stories**:

* As the wagering application, I want to find and persist wallets, wager transactions, and ledger entries so that a later BET use case can operate on consistent domain entities.
* As the wagering application, I want related writes to commit or roll back together so that a partial failure cannot leave a wallet balance without its transaction and ledger record.

**Acceptance criteria**:

* **AC-1**: Domain repository contracts exist for `Wallet`, `WagerTransaction`, and `WalletLedgerEntry` without depending on MikroORM types.
* **AC-2**: `WalletRepository` can find a wallet by player and currency, can find and lock that wallet for update inside a transaction, and returns `null` when no wallet exists.
* **AC-3**: `WagerTransactionRepository` can find by idempotency key and by provider with external transaction ID. Its save operation supports new and already loaded transactions.
* **AC-4**: `WalletLedgerEntryRepository` can find entries by transaction and can add new entries only. Its contract does not allow updates or deletes.
* **AC-5**: One unit of work supplies all repositories bound to the same MikroORM transaction. Successful work flushes once and commits; callback or flush failure rolls back all writes and propagates the error.
* **AC-6**: The wallet lock serializes concurrent work for the same wallet. Work for different wallets can proceed independently.
* **AC-7**: Existing database uniqueness constraints remain the final guard against repeated idempotency keys, repeated provider transaction IDs, and duplicate ledger entries. Persistence errors are not silently converted or retried by repositories.
* **AC-8**: Integration tests use a disposable PostgreSQL service with no persistent volume and verify lookups, wallet locking, atomic rollback, existing uniqueness constraints, and ledger immutability.

## Decision

**Chosen option**: Option 2: Domain repository contracts with MikroORM adapters and a unit of work.

Define repository contracts for all three entities, implement them in infrastructure with MikroORM, and expose them only inside a unit of work callback. The callback uses one transaction scoped entity manager, performs one flush at completion, and rolls back on any failure.

## Feature design

**Data model sketch**:

No schema change or new migration is needed for this slice. Repositories persist the existing entities and relationships.

| Entity | Primary key and fields | Foreign keys and relationships | Existing constraints |
|---|---|---|---|
| `Wallet` | `id` UUID, `playerId`, `balanceAmount` numeric(18,2), `balanceCurrency`, `version`, `createdAt`, `updatedAt` | One wallet has many wager transactions and ledger entries | Unique player and currency; balance is nonnegative |
| `WagerTransaction` | `id` UUID, wallet, kind, amount and currency, status, idempotency key, payload hash, external and internal references, provider ID, external transaction ID, player ID, round ID, game ID, timestamps, failure code | Many transactions belong to one wallet; each transaction may reference zero or one other transaction, and a transaction may be referenced by many transactions; one transaction can have many ledger entries | Unique idempotency key; unique provider and external transaction ID; positive amount |
| `WalletLedgerEntry` | `id` UUID, wallet, transaction, type, direction, money amount and currency, balance before and after with currencies, creation time | Each entry belongs to one wallet and one wager transaction | Unique wallet and transaction; positive amount; nonnegative balances; consistent currencies; immutable after insert |

**API surface**:

These are internal TypeScript contracts, not HTTP endpoints. All find operations return the matching entity or `null`. Database errors propagate to the caller.

| Operation | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `WalletRepository.findByPlayerAndCurrency` | Function | `playerId: string`, `currency: Currency` | `Wallet` or `null` | Internal application access | Database error |
| `WalletRepository.findByPlayerAndCurrencyForUpdate` | Function | `playerId: string`, `currency: Currency`, within unit of work | Locked `Wallet` or `null` | Internal application access | Database error; invalid use outside a transaction |
| `WalletRepository.save` | Function | `wallet: Wallet` | `void` | Internal application access | Database error |
| `WagerTransactionRepository.findByIdempotencyKey` | Function | `idempotencyKey: string` | `WagerTransaction` or `null` | Internal application access | Database error |
| `WagerTransactionRepository.findByProviderAndExternalTransactionId` | Function | `providerId: string`, `externalTransactionId: string` | `WagerTransaction` or `null` | Internal application access | Database error |
| `WagerTransactionRepository.save` | Function | `transaction: WagerTransaction` | `void` | Internal application access | Database error; uniqueness conflict |
| `WalletLedgerEntryRepository.findByTransactionId` | Function | `transactionId: string` | Read only list of entries | Internal application access | Database error |
| `WalletLedgerEntryRepository.add` | Function | `entry: WalletLedgerEntry` | `void` | Internal application access | Database error; uniqueness conflict |
| `WageringUnitOfWork.transaction` | Function | Async callback receiving the three repositories | Callback result after commit | Internal application access | Callback or flush error, with rollback |

Repositories do not flush individually. The unit of work uses the transaction scoped entity manager from `EntityManager.transactional`, makes the repositories available only to its callback, and flushes once before commit. `findByPlayerAndCurrencyForUpdate` uses a PostgreSQL row lock and is valid only in that transaction.

**Value sourcing**:

| Action | Value produced or used | Source |
|---|---|---|
| Find and lock wallet | `playerId` and `currency` | Arguments supplied by the wagering application service from its validated request |
| Find transaction by idempotency | `idempotencyKey` | Required `Idempotency-Key` header supplied to the wagering application service |
| Find transaction by provider identity | `providerId` and `externalTransactionId` | Validated wagering request fields |
| Find ledger entries | `transactionId` | `WagerTransaction.id` |
| Save wallet or transaction | Entity fields and state | Existing domain entity |
| Add ledger entry | Amount, direction, before and after balances, and relationships | Existing `WalletLedgerEntry` created by the domain logic |
| Serialize access to a wallet | Locked database row | `wallets` row matching player and currency |
| Detect duplicate writes | Unique key or constraint violation | Existing PostgreSQL constraints |

**Key invariants**:

* Repositories used in a BET operation belong to one unit of work and one PostgreSQL transaction.
* The wallet row is locked before the wagering application service reads and changes its balance.
* A balance change, its wager transaction, and its ledger entry are committed together or all rolled back.
* An existing idempotency key with the same payload is a safe replay. A different payload for that key is a conflict. Reuse of a provider transaction ID with a different key is also a conflict. The wagering application service handles these outcomes after a uniqueness race by rolling back, rereading the existing transaction, and comparing its payload hash.
* Repositories do not retry persistence failures or hide database errors.
* Ledger entries are inserted only. The existing database trigger rejects updates and deletes.
* Searches use existing unique keys or indexes. No list endpoint or pagination behavior is introduced.

**Security model**:

Repositories are internal application components and are not an authorization boundary. They do not expose endpoints or log player identifiers, balances, or wager payloads. The current HTTP API does not authenticate providers or verify their identity; add authentication and validate player context before public exposure. No specific regulatory standard or additional retention rule was provided. The immutable ledger remains the audit record for money changes.

**Configuration required**:

None for the application. Integration tests use a separate PostgreSQL Compose profile with a disposable service and no persistent volume.

**Critical test scenarios**:

* Happy path: repositories save and reload a wallet, wager transaction, and ledger entry in one transaction, verifies **AC-2**, **AC-3**, **AC-4**, and **AC-5**.
* Failure case: a failure during the callback or flush rolls back all related changes; concurrent operations lock the same wallet; database uniqueness and ledger immutability remain enforced, verifies **AC-5**, **AC-6**, **AC-7**, and **AC-8**.
* Access boundary: repository providers are available only to internal application code, with no public endpoint or authorization behavior added, verifies **AC-1**.

## Build plan

1. Add domain contracts for the three repositories and the unit of work, including nullable find results and insert only ledger writes. Do not change the existing schema, satisfies **AC-1**, **AC-2**, **AC-3**, and **AC-4**.
2. Add MikroORM adapters and NestJS wiring. Bind every adapter in a unit of work to the transaction scoped entity manager, lock wallets on lookup for update, and flush once at completion, satisfies **AC-2**, **AC-3**, **AC-4**, **AC-5**, and **AC-6**.
3. Add a Compose test profile with an isolated PostgreSQL service and integration tests for transaction rollback, locking, lookups, uniqueness, and ledger immutability. Apply the existing migration to the disposable test database, satisfies **AC-5**, **AC-6**, **AC-7**, and **AC-8**.

## Consequences

**Positive**:

* Application code can depend on domain contracts instead of MikroORM.
* A financial operation has one explicit transaction scope.
* Existing database constraints remain active as protection against concurrent duplicate writes.

**Negative / tradeoffs**:

* The unit of work and adapters add interfaces and dependency injection setup.
* Same wallet operations wait on a database lock, so a busy wallet has serialized processing.
* PostgreSQL integration tests require Docker and take longer than isolated unit tests.
* This repository slice defines persistence only. The HTTP wagering flow and idempotent replay are defined in [spec 0004](../0004-wagering-transactions-api/index.md).

**Neutral**:

* No production environment variables, tables, or migration are added.
* The team must start the disposable test database before running repository integration tests.

## Follow-up

* Provider authentication and verified player context must be added before public exposure; repository contracts are not an authorization boundary.
* Asynchronous message processing, outbox, retries, and DLQ are not part of this repository slice.
