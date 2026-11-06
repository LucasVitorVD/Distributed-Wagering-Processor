# Verify: BET repositories · spec 0001 · updated 2026-11-05

_Steps derived from spec 0001 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

No screen is part of this feature.

## Commands

- [ ] `npm run build && npx tsc --noEmit --incremental false` → build and type checks pass, and the domain contracts do not import MikroORM types → AC-1
- [ ] `npm run test:integration:db:up && npm run test:integration` → wallet lookup matches the supplied player and currency, returns null for missing or different values, and the locked lookup finds the matching row → AC-2
- [ ] `npm run test:integration` → the supplied idempotency key finds its transaction, and both provider ID and external transaction ID must match → AC-3
- [ ] `npm run test:integration` → saving new and loaded transactions works, changed domain state persists, and ledger lookup uses `WagerTransaction.id` → AC-3, AC-4
- [ ] `npm run test:integration` → a domain created ledger entry reloads with its amount, direction, before balance, and after balance, and its repository exposes no update or delete operation → AC-4
- [ ] `npm run test:integration` → callback failure and flush failure roll back all related writes and propagate their errors → AC-5, AC-7
- [ ] `npm run test:integration` → a second operation waits for the same wallet lock while a different wallet can proceed → AC-6
- [ ] `npm run test:integration` → PostgreSQL rejects duplicate idempotency keys, provider transaction IDs, and ledger entries, and the ledger trigger rejects update and delete attempts → AC-7, AC-8
- [ ] `npm run test:integration:db:down` → the disposable database service and network are removed → AC-8

## Acceptance-criteria coverage

- AC-1 is covered by the domain contracts and build and type checks.
- AC-2 is covered by player and currency lookups, missing results, and row lock checks.
- AC-3 is covered by idempotency and provider identity lookups and saving new and loaded transactions.
- AC-4 is covered by transaction based ledger lookup and insert only repository operations.
- AC-5 is covered by a single transaction scope and rollback checks for callback and flush failure.
- AC-6 is covered by same wallet contention and independent wallet lock checks.
- AC-7 is covered by uniqueness constraints and propagated database errors.
- AC-8 is covered by disposable PostgreSQL, migration application, and ledger immutability checks.
