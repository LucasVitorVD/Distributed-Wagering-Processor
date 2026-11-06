# Rationale · Wagering transaction API

## Context

The service already stores wallets, wagering transactions, and immutable ledger entries. It also has repository contracts, a transaction scoped unit of work, a wallet lock, and database uniqueness constraints for idempotency keys and provider transaction identities. The domain supports BET, WIN, LOSS, REFUND, and ROLLBACK, but no HTTP route processes or reads those transactions.

> ⚠️ Premise note: These routes change and reveal financial data without provider authentication or rate limiting. This is acceptable only for the technical challenge and local evaluation. Do not expose the routes publicly until authentication and request limiting are designed and added.

The API must distinguish a safe retry from a reused key with changed business data. It must also handle repeated provider transaction identities, concurrent calls, and references between reversals. No production compliance standard, traffic target, or retention policy has been specified for this challenge.

## Options considered

### Option 1: Process synchronously through the current unit of work

The application service locks the wallet and commits the transaction, balance update, and ledger entry together. Existing transaction records provide the durable idempotency result.

**Pros**:

* Uses the transaction boundary, row lock, entities, and constraints already in the project.
* A successful response represents a committed outcome.
* No new table, queue, worker, or service is required.

**Cons**:

* Calls for the same wallet serialize while the database lock is held.
* The request depends on PostgreSQL availability for the full operation.

### Option 2: Accept requests and process them asynchronously

The API stores an initial request and a worker applies the transaction later.

**Pros**:

* The HTTP request can finish before wallet processing completes.
* A queue can absorb bursts if measured traffic later requires it.

**Cons**:

* It introduces a queue, worker, retries, and operational monitoring.
* Callers see a pending outcome instead of a final balance result.
* It adds eventual consistency without a current volume or latency need.

### Option 3: Add a separate idempotency response store

The service stores request hashes and complete HTTP responses in a new table, separately from wagering transactions.

**Pros**:

* It can retain the original response independently of transaction fields.
* It can support a separate retention policy for idempotency records.

**Cons**:

* It duplicates identity and outcome data already persisted on `WagerTransaction`.
* It adds a schema, a second persistence lifecycle, and more consistency cases.
* The compact response needs only a small result snapshot, not a separate response store.

## POST balance response

The challenge response includes a balance with the transaction status. Returning the wallet's current balance on every retry would make an idempotent response change after a later wager. A separate response table could preserve the entire original HTTP body, but it would duplicate transaction identity and add another persistence lifecycle. Store the outcome balance amount and currency on `WagerTransaction` instead. The snapshot is written in the same unit of work as the wallet change and transaction, so the existing row lock and transaction boundary keep the result consistent.

For older rows, a ledger entry contains the resulting balance when one exists. Older LOSS and REJECTED rows have no ledger entry, so their exact historical result cannot be reconstructed. The migration uses the wallet balance and currency at migration time for those rows. This is a compatibility snapshot, not a reconstruction of the original outcome. New API outcomes always save their exact result balance.

## Rationale

The service already has the transaction boundary and database constraints needed to make wallet, transaction, and ledger writes atomic. Processing synchronously is the smallest path that produces a final result without adding operational infrastructure the project does not currently have. Keeping the balance snapshot on the transaction makes the returned result stable across retries while avoiding a separate response table.

The API follows the challenge boundary by deferring authentication and request limiting, but this is not a production security posture. The provider ID is a claimed request value, not verified identity. Keeping the restriction explicit in the API contract and README is safer than implying that a provider path or idempotency key authenticates a caller.
