# Verify: Wagering transaction API · spec 0004 · updated 2026-11-06

_Steps derived from spec 0004 acceptance criteria. The latest automated integration run passed on 2026-11-06; these steps remain a review checklist and are not all automated._

## UI / manual

- [ ] Request a transaction by a valid internal UUID and by its provider pair. Confirm both return the same public fields, with no idempotency key or payload hash. Try a malformed UUID and a valid missing identity. Expect `400 VALIDATION_ERROR` and `404 WAGER_TRANSACTION_NOT_FOUND`. → AC-1, AC-2, AC-11
- [ ] Submit a BET with a missing, blank, or overlong `Idempotency-Key`, invalid amount, unsupported kind, invalid reference use, or extra field. Confirm each returns `400 VALIDATION_ERROR` and creates no transaction. → AC-3, AC-9
- [ ] Submit a BET for a wallet with funds. Confirm the transaction, debit, and one ledger entry commit together. Cause a persistence failure in a controlled test and confirm no part commits and the key can be retried. → AC-4
- [ ] Submit WIN, LOSS, REFUND, and ROLLBACK transactions. Confirm the balance direction and ledger behavior for each. Confirm `OPENING` is rejected by this route. → AC-5
- [ ] Submit partial refunds whose net sum is below, equal to, and above the bet amount. Confirm the over limit refund is stored as `REJECTED`. Roll back a refund, then confirm its amount is again available for refund. Confirm a bet with a net refund cannot be rolled back. → AC-6
- [ ] Submit a BET with insufficient funds and a REFUND or ROLLBACK with an unavailable reference. Confirm each is stored as `REJECTED`, with no balance or ledger change. Submit for a player without a wallet, then create the wallet and retry with the same key. Expect the first request to return `404 WALLET_NOT_FOUND` and the retry to process normally. → AC-7
- [ ] Repeat a request using the same key and payload, changing `amount.amount` from `5` to `5.00`. Confirm the second response replays the stored result. Change another business field with the same key and expect `409 IDEMPOTENCY_CONFLICT`. → AC-8, AC-9
- [ ] Submit the same provider identity with a different key and expect `409 DUPLICATE_TRANSACTION`. Submit matching requests concurrently and confirm one balance effect and one replay. Submit different payloads concurrently with one key and confirm one commit and one conflict. → AC-10
- [ ] Inspect GET and POST responses. Confirm GET contains the agreed transaction fields, POST contains exactly `transactionId`, `status`, `balance`, and `idempotentReplay`, `balance.amount` is a two decimal string, and neither response exposes idempotency key or payload hash. → AC-11
- [ ] Cause an unexpected persistence failure. Confirm the response is sanitized as `500 INTERNAL_SERVER_ERROR`, the transaction rolls back, the key remains available, and logs contain no request body, amount, provider identifier, or key. → AC-12
- [ ] Read the wagering transaction section in the README. Confirm it documents routes, examples, canonical hash rules, and the need for authentication and request limiting before public exposure. → AC-13

## Commands

- [ ] `bun run build` → compiles the routes, DTOs, service, and persistence adapters. → AC-1 through AC-11
- [ ] `bun run lint` → succeeds without warnings on validation and error handling code. → AC-3, AC-12
- [ ] `bun run test` → unit tests pass, including the canonical hash and normalized amount assertion. → AC-8, AC-11
- [ ] `bun run test:integration` → PostgreSQL tests pass, including atomic changes, rejection, replay, unique conflicts, concurrency, and transaction lookups. → AC-1 through AC-11
- [ ] Inspect the snapshot migration on a database with a ledger backed transaction and a transaction without a ledger entry. Confirm the former uses ledger after balance and currency, and the latter uses the wallet's migration time balance and currency. → AC-4, AC-11

## Acceptance criteria coverage

AC-1 and AC-2 are covered by the lookup checks. AC-3 and AC-9 are covered by request validation and replay checks. AC-4 is covered by atomicity and persistence failure checks. AC-5 and AC-6 are covered by transaction type, refund, and rollback checks. AC-7 is covered by business rejection and missing wallet checks. AC-8 is covered by normalized amount and changed payload checks. AC-10 is covered by unique identity and concurrency checks. AC-11 is covered by response inspection. AC-12 is covered by persistence failure and safe log checks. AC-13 is covered by README inspection.

## Value sourcing coverage

- [ ] Create two BRL wallets for different players, submit a transaction for one player, and confirm the returned `walletId` belongs to the wallet found by that `playerId` and currency. → Resolve a wallet
- [ ] Submit a request with an `Idempotency-Key`, then retry with that key. Confirm replay lookup uses the header value and the value is never returned. → Identify a request for replay
- [ ] Submit equivalent normalized amounts and compare the replay outcome. Change one business field and confirm a conflict. → Compute the payload hash
- [ ] Look up by internal ID and confirm each response field matches the stored transaction and its related wallet ID. → Return an internal transaction lookup
- [ ] Look up by an exact provider pair, then alter one identifier and confirm the altered pair is not returned. → Return a provider transaction lookup
- [ ] Apply BET, WIN, LOSS, REFUND, and ROLLBACK against known balances. Confirm the locked balance and transaction kind determine the resulting balance and ledger direction. → Apply a transaction
- [ ] Apply a transaction, change the wallet with a later transaction, and replay the first request. Confirm the returned balance is its original saved result, not the current wallet balance. → Return the POST balance
- [ ] Read the wallet ledger and compare amount, direction, before balance, and after balance with the committed ledger entry. → Return a ledger entry
- [ ] Trigger a valid business rejection and confirm status and failure code match the persisted transaction. → Return transaction status and failure code
- [ ] Repeat a matching key and hash, then reuse the key with a different hash. Confirm only the matching request has `idempotentReplay: true`. → Return replay indicator
- [ ] Trigger validation, missing wallet, missing transaction, conflict, and unexpected persistence errors. Confirm each error code and status comes from the documented validation, lookup, domain, conflict, or exception handling path. → Return an error
