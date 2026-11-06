# 0003. Wallet query API

**Date**: 2026-11-06
**Status**: Implemented

## Summary

These routes let a game service read a wallet balance and its ledger history. The history uses cursor pagination, which continues from the last item instead of skipping a number of rows. The routes use the existing PostgreSQL data and response conventions, with no new tables or services.

## Context

At the time this spec was written, the service could create a wallet, but clients could not yet read its balance or ledger history. The wallet balance is stored on the wallet, while each ledger entry stores its own amount, direction, before and after balances, and creation time. The existing repositories did not yet provide lookup by wallet identifier or paged ledger reads.

The game service needs to show the current balance and inspect all kinds of ledger entries. Ledger history can grow over time, and new entries can be added while a client reads earlier pages. The endpoints also remain part of a challenge application without authentication or request limits.

## Requirements

**User stories**:

* As a game service, I want to read a wallet balance so that I can show the player's current funds.
* As a game service, I want to read a wallet's ledger history in pages so that I can show financial activity without loading the entire history at once.

**Acceptance criteria**:

* **AC-1**: `GET /wallets/:walletId` returns HTTP `200` with `id`, `playerId`, `balance` as `{ "amount": string, "currency": string }`, and `version`. The amount is a normalized decimal string with two fractional digits, matching the current `POST /wallets` response (basis: `src/wallets/wallet-creation.service.ts`).
* **AC-2**: A malformed `walletId` returns HTTP `400` with code `VALIDATION_ERROR`. UUID validation follows the existing `CreateWalletDto` validator.
* **AC-3**: `GET /wallets/:walletId/ledger` returns HTTP `200` and every ledger type, newest first. Each item contains `id`, `transactionId`, `type`, `direction`, `amount`, `balanceBefore`, `balanceAfter`, and `createdAt`. Types are `OPENING`, `BET`, `WIN`, `LOSS`, `REFUND`, or `ROLLBACK`; directions are `CREDIT` or `DEBIT`. Each money value is an object with a two decimal amount string and its currency, serialized by the existing `Money` format without rounding. Supported currencies are `BRL`, `USD`, and `EUR`. The ledger amount is positive, and balance amounts are nonnegative. `createdAt` is ISO 8601 in UTC with millisecond precision, matching the `Date` values stored by the application. Entries with the same creation time are ordered by `id` descending.
* **AC-4**: Ledger pagination accepts an optional `cursor` and an optional integer `limit`. Each parameter may occur at most once. The default limit is `50`, and valid limits are from `1` through `100`. A supplied limit must be a base ten digit string with no sign, spaces, decimal point, exponent, or leading zero. Invalid or repeated parameters return HTTP `400` with code `VALIDATION_ERROR`.
* **AC-5**: Ledger responses contain `items`, `nextCursor`, and `limit`. A valid request returns HTTP `200`. The cursor is an opaque, unpadded Base64URL encoded JSON object with exactly `v`, `walletId`, `createdAt`, and `id`. `v` is the integer `1`; `walletId` and `id` follow the existing UUID validator; `createdAt` is a canonical `YYYY-MM-DDTHH:mm:ss.sssZ` value matching the exact UTC millisecond value used by the database sort key. The server uses `createdAt` and `id` as a descending keyset, and checks for one extra result to determine whether another page exists. It returns a cursor for the last item in the page only when another page exists; otherwise `nextCursor` is `null`. For an unchanged ledger, pages have no repeats or skips. The cursor is not a snapshot: entries ordered before its position are not included in that traversal and appear after the client restarts from the first page; entries ordered after its position may appear on a later page.
* **AC-6**: The cursor must contain all four fields with the types and format defined in AC-5, and must not contain extra fields. A malformed cursor, a cursor longer than `512` encoded characters, an unsupported cursor version, or a cursor associated with another wallet returns HTTP `400` with code `VALIDATION_ERROR`. The cursor does not expire and is only a page position, not an authorization token.
* **AC-7**: After path and query validation succeeds, a wallet that does not exist returns HTTP `404` with code `WALLET_NOT_FOUND` on either route. Invalid path or query input returns `400` before wallet lookup. An existing wallet with no ledger entries returns HTTP `200` with `items: []`, `nextCursor: null`, and the requested or default `limit`.
* **AC-8**: Errors use the existing shape `{ "statusCode": number, "code": string, "message": string }`, with messages in Portuguese and the existing project wording conventions; exact message text is not part of the API contract. Unexpected errors return HTTP `500` with code `INTERNAL_SERVER_ERROR`. Logs do not contain SQL, query parameters, request bodies, raw URLs, exception messages, stack traces, balances, or ledger contents (basis: `src/common/filters/api-exception.filter.ts` and `docs/specs/0002-wallet-creation-api.md`).
* **AC-9**: The routes have no authentication, ownership check, or request limit for this challenge. The README states this limitation, but the service must remain restricted to challenge evaluation and must not be exposed publicly before authentication and request limiting are added.

## Options considered

### Option 1: Add queries to the existing repository path

Add wallet lookup and paged ledger query methods to the current repository contracts and MikroORM adapters. A wallet read service accesses those methods through the existing unit of work context without writing data, validates the result, and builds the response. Controllers handle HTTP inputs and status codes (basis: existing repository and unit of work patterns).

**Pros**:

* Uses the repository and unit of work boundaries already present in the project (basis: `src/domain/repositories/wagering-repositories.ts`).
* Keeps SQL ordering and cursor conditions out of controllers.
* Adds the requested routes without changing current write behavior.

**Cons**:

* The existing unit of work opens a database transaction for reads, even though these operations do not mutate data.
* The query uses the current ledger indexes, which may need review if the ledger grows substantially.

### Option 2: Query MikroORM directly from the HTTP layer

Inject the entity manager into a controller or its service and issue the reads there (basis: `src/infrastructure/persistence/mikro-orm/wagering-unit-of-work.ts`).

**Pros**:

* Requires less repository interface work for a small feature.
* MikroORM supports the required ordering and filtering.

**Cons**:

* It creates a separate data access path beside the existing repository pattern.
* Cursor query behavior becomes harder to test without database aware HTTP code (basis: repository pattern for testable data access).

### Option 3: Add a separate read model or cache

Copy wallet and ledger data into a read optimized store or cache, and serve these endpoints from that data (basis: database query optimization guidance).

**Pros**:

* It can support read volume or response patterns that the transactional tables cannot handle.
* It can isolate future reporting queries from wallet writes.

**Cons**:

* It duplicates financial data and requires synchronization and stale data handling.
* No measured read bottleneck justifies the extra infrastructure for this challenge (basis: measure before optimizing).

## Decision

**Chosen option**: Option 1: Add queries to the existing repository path.

Add read methods for wallet lookup and ledger pagination to the existing persistence contracts and MikroORM adapters. Access them through the existing unit of work context without writes. Keep HTTP validation and response mapping in the wallet feature, and read directly from PostgreSQL without a cache (basis: existing project persistence pattern).

## Rationale

The service already uses repository contracts and a unit of work for wallet and ledger persistence. Extending that path keeps query logic testable and consistent with the existing write flow (basis: `src/domain/repositories/wagering-repositories.ts` and `src/infrastructure/persistence/mikro-orm/wagering-unit-of-work.ts`). The endpoints add new behavior rather than replacing an existing read path, so a separate strangler migration is not useful.

There is no measured performance problem or need for a second store. A cursor based query avoids offset shifting when new entries arrive, while avoiding a cache that could show an old balance (basis: keyset pagination and measure before optimizing). The cursor is versioned so a later server can deliberately reject or support a new format without exposing its contents as a client contract. Its timestamp preserves the millisecond precision of the `Date` values used by the existing ledger creation path, so the sort key and cursor comparison use the same value.

## Feature design

**Data model sketch**:

No entity or table changes are required. Read `Wallet` fields `id`, `playerId`, `balanceAmount`, `balanceCurrency`, and `version`, and read `WalletLedgerEntry` fields `id`, `transactionId`, `type`, `direction`, `moneyAmount`, `moneyCurrency`, `balanceBeforeAmount`, `balanceBeforeCurrency`, `balanceAfterAmount`, `balanceAfterCurrency`, and `createdAt` (basis: the existing wallet and ledger entities). Ledger entries remain immutable and continue to reference their wallet and wager transaction (basis: `docs/specs/0001-bet-repositories/index.md`).

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/wallets/:walletId` | `GET` | `walletId: UUID` | `id`, `playerId`, `balance`, `version` | None for the challenge | `400 VALIDATION_ERROR`, `404 WALLET_NOT_FOUND`, `500 INTERNAL_SERVER_ERROR` |
| `/wallets/:walletId/ledger` | `GET` | `walletId: UUID`, optional `cursor`, optional `limit` | `items`, `nextCursor`, `limit` | None for the challenge | `400 VALIDATION_ERROR`, `404 WALLET_NOT_FOUND`, `500 INTERNAL_SERVER_ERROR` |

Example wallet response:

```json
{
  "id": "b9fcce4c-566f-4965-8140-f0222460fe12",
  "playerId": "4e7c7d27-2b9f-45cc-8ac3-11843083b2fc",
  "balance": {
    "amount": "25.00",
    "currency": "BRL"
  },
  "version": 1
}
```

Example ledger response:

```json
{
  "items": [
    {
      "id": "1e2bb8fb-7c9a-4f2e-8aca-71c1d066b510",
      "transactionId": "cc7641e5-f036-4596-9aa4-a2cefe9e161f",
      "type": "OPENING",
      "direction": "CREDIT",
      "amount": {
        "amount": "25.00",
        "currency": "BRL"
      },
      "balanceBefore": {
        "amount": "0.00",
        "currency": "BRL"
      },
      "balanceAfter": {
        "amount": "25.00",
        "currency": "BRL"
      },
      "createdAt": "2026-11-06T17:38:13.720Z"
    }
  ],
  "nextCursor": null,
  "limit": 50
}
```

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| Read wallet | `id`, `playerId`, `version` | `Wallet.id`, `Wallet.playerId`, and `Wallet.version` |
| Read wallet | Balance amount and currency | `Wallet.balanceAmount` and `Wallet.balanceCurrency`, serialized by the existing `Money` format |
| Read ledger | `id`, `transactionId`, `type`, `direction`, and `createdAt` | The matching `WalletLedgerEntry` fields and its related transaction identifier |
| Read ledger | `amount`, `balanceBefore`, and `balanceAfter` | Ledger amount and balance columns, paired with their stored currency columns |
| Read ledger | Item order and cursor position | `WalletLedgerEntry.createdAt` and `WalletLedgerEntry.id`, descending |
| Read ledger | `limit` | Query parameter, or the default value `50` |
| Read ledger | `nextCursor` | The last returned entry's wallet identifier, creation time, and identifier, encoded in version `1`; only present when the extra row proves another page exists |
| Return an error | Status, code, and message | UUID and query validation, wallet lookup, or the existing global exception filter |

**Key invariants**:

* Reads do not mutate a wallet, transaction, or ledger entry.
* Ledger pages contain entries for only the requested wallet.
* Ledger ordering is always `createdAt` descending, then `id` descending. The cursor comparison uses the same fields and direction.
* A page query returns the transaction identifier without issuing one additional query for each entry.
* The cursor is bound to the wallet in the route and cannot be used to read another wallet.
* A cursor describes a position, not a snapshot. Entries created before that position are visible after the client starts again without a cursor.
* A cursor is not authorization. These routes remain unsafe for public exposure without authentication and request limiting.

**Security model**:

These challenge routes do not authenticate the caller or check wallet ownership. Anyone who can reach the service and knows a wallet identifier can read its balance and history. The README warning does not restrict access, so the deployment must remain available only to challenge evaluation. Add authentication, ownership checks, and request limiting before public exposure.

**Critical test scenarios**:

* Wallet happy path: an existing wallet returns its normalized balance and version, verifies **AC-1**.
* Wallet lookup errors: malformed identifiers return `400`; unknown identifiers return `404`, verifies **AC-2** and **AC-7**.
* Ledger happy path: entries of different types return with their money fields, newest first, and stable identifier tie breaking, verifies **AC-3**.
* Pagination: default and explicit limits work; pages over an unchanged ledger have no repeats or skips; a newer entry before the cursor is absent from the current traversal and appears after restarting from the first page; the final page has a null cursor, verifies **AC-4** and **AC-5**.
* Cursor errors: malformed, oversized, unsupported, or wallet mismatched cursors return `400`, verifies **AC-6**.
* Validation precedence: an invalid cursor returns `400` before checking whether the wallet exists; a valid request for an unknown wallet returns `404`, verifies **AC-6** and **AC-7**.
* Empty history: an existing wallet returns an empty list, verifies **AC-7**.
* Error and security behavior: unexpected errors return the common error shape and logs contain no SQL or financial data; README states the challenge security boundary, verifies **AC-8** and **AC-9**.

## Build plan

The project uses a Tracer Bullet approach. First connect the wallet read through the existing repository path, then add ledger pagination through the same persistence boundary, with HTTP validation and error behavior tested end to end.

1. Add wallet lookup by identifier to the repository contract and MikroORM adapter, then return the agreed wallet response. Add focused service and HTTP tests. Satisfies **AC-1**, **AC-2**, and **AC-7**.
2. Add ordered ledger lookup with cursor conditions and a one row lookahead to the repository contract and MikroORM adapter. Add cursor encoding, decoding, validation, and response mapping in the wallet feature. Satisfies **AC-3**, **AC-4**, **AC-5**, **AC-6**, and **AC-7**.
3. Update the global exception filter to avoid sensitive query, request, and financial data in logs, while preserving the agreed HTTP error shape. Add tests for the safe logging behavior. Satisfies **AC-8**.
4. Update the README with the new routes and their challenge only security boundary. Satisfies **AC-9**.
5. Add PostgreSQL integration tests for cursor ordering, page boundaries, empty history, and wallet isolation. Satisfies **AC-3**, **AC-5**, **AC-6**, and **AC-7**.

## Consequences

**Positive**:

* The game service can show the current balance and browse the immutable history.
* Cursor pagination avoids offset shifts when newer ledger entries are added.
* The feature reuses the current database and persistence architecture.

**Negative / tradeoffs**:

* The cursor format becomes a server maintained contract, even though clients must treat it as opaque.
* Without a dedicated composite index for wallet, creation time, and identifier, PostgreSQL may do more work as ledger history grows. No workload data currently justifies a schema change; measure query performance before adding an index.
* The routes expose financial data to callers who know a wallet identifier, because authentication and ownership checks are outside the challenge.
* Sanitized error logs provide less detail when an unexpected failure occurs.

**Neutral**:

* No migration, new environment variable, cache, or external service is needed.
## Follow-up

* Add authentication, wallet ownership checks, and request limiting before public exposure.

## References

**Project sources**:

* `src/domain/wallet/wallet.entity.ts` and `src/domain/ledger/wallet-ledger-entry.entity.ts`, current wallet and ledger fields.
* `src/domain/repositories/wagering-repositories.ts` and `src/infrastructure/persistence/mikro-orm/wagering-unit-of-work.ts`, current repository and unit of work patterns.
* `src/common/filters/api-exception.filter.ts`, current error response and logging behavior.
* `src/wallets/wallet-creation.service.ts`, the current wallet response shape.
* `src/wallets/dto/create-wallet.dto.ts`, the current UUID validation convention.
* `src/domain/shared/money.ts`, the existing exact two decimal serialization rule.
* `docs/specs/0002-wallet-creation-api.md`, wallet response and challenge security conventions.

**Practices & standards**:

* Keyset pagination, using the last row's sort keys instead of an offset.
