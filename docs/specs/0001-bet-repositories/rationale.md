# Rationale: Repositories for BET processing

## Context

The project already has `Wallet`, `WagerTransaction`, and `WalletLedgerEntry` entities stored in PostgreSQL through MikroORM. The database has unique constraints for wallet ownership, transaction idempotency, external transaction identity, and ledger entries. The ledger also rejects updates and deletes.

The application has no repository layer yet. A BET operation will need to find an existing transaction, lock the correct wallet, change its balance, and persist the transaction and ledger entry together. This specification covers that persistence layer only. It does not implement the BET use case, provider authentication, or an HTTP endpoint.

> Premise note: Repositories alone cannot guarantee that a BET is charged only once. The later application use case must compare the existing payload hash and make the wallet, transaction, and ledger changes in the same unit of work. Provider authentication also remains undecided and must be designed before an external BET endpoint is exposed.

## Options considered

### Option 1: Inject MikroORM repositories directly into application services

Application services use MikroORM repositories and the entity manager directly for all reads and writes.

**Pros**:

* Requires fewer interfaces and less initial wiring.
* Uses MikroORM identity tracking and transactions directly.

**Cons**:

* Application services depend on persistence details.
* It is easier to use repositories attached to different entity managers and accidentally split a financial operation across transactions.

### Option 2: Domain repository contracts with MikroORM adapters and a unit of work

The domain defines repository contracts. Infrastructure implements them with MikroORM. A unit of work opens one transaction and provides transaction scoped repositories to its callback.

**Pros**:

* Domain contracts do not expose ORM types.
* A single transaction scope makes atomic wallet, transaction, and ledger writes explicit.
* The wallet lock is only available in a transaction.

**Cons**:

* Adds interfaces, adapters, and dependency injection wiring.
* Transaction scoped repository construction needs focused integration tests.

### Option 3: One unit of work with direct entity manager access

Application services receive a transaction scoped entity manager and issue queries directly, without repository contracts.

**Pros**:

* Keeps transaction ownership explicit with fewer adapters.
* Uses MikroORM directly for complex queries.

**Cons**:

* Query logic can spread across application services.
* It does not provide the requested domain repository contracts and makes persistence behavior harder to test independently.

## Rationale

The domain entities and PostgreSQL constraints already define the important invariants. The missing piece is a persistence boundary that makes it difficult to write the wallet, transaction, and immutable ledger entry through separate transactions. A unit of work binds all three repositories to one transaction and gives the wallet lookup a clear place to acquire its row lock.

Direct ORM access would be smaller at first, but it leaves transaction consistency to each application service. The selected structure costs more wiring, but it fits the money and idempotency requirements while reusing the existing NestJS, MikroORM, and PostgreSQL stack. The database remains responsible for uniqueness and the application use case remains responsible for deciding whether a duplicate payload is a safe replay or a conflict.
