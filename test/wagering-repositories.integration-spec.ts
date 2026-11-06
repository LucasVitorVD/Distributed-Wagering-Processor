import { randomUUID } from 'node:crypto';
import { MikroORM } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import config from '../src/config/mikro-orm.config.js';
import { WalletLedgerEntry } from '../src/domain/ledger/wallet-ledger-entry.entity.js';
import { Money } from '../src/domain/shared/money.js';
import type { WageringUnitOfWork } from '../src/domain/repositories/wagering-repositories.js';
import { Wallet } from '../src/domain/wallet/wallet.entity.js';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../src/domain/wagering/wager-transaction.entity.js';
import { MikroOrmWageringUnitOfWork } from '../src/infrastructure/persistence/mikro-orm/wagering-unit-of-work.js';
import { WalletCreationService } from '../src/wallets/wallet-creation.service.js';

const databaseConfig = {
  ...config,
  dbName: process.env.POSTGRES_TEST_DB ?? 'wagering_test',
  user: process.env.POSTGRES_TEST_USER ?? 'wagering_test',
  password: process.env.POSTGRES_TEST_PASSWORD ?? 'wagering_test',
  host: process.env.POSTGRES_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.POSTGRES_TEST_PORT ?? 5434),
  entities: [Wallet, WagerTransaction, WalletLedgerEntry],
  entitiesTs: [],
  migrations: {
    ...config.migrations,
    path: './dist/migrations',
    pathTs: './dist/migrations',
  },
};

function createWallet(playerId = randomUUID(), amount = '100.00'): Wallet {
  return Wallet.open({
    id: randomUUID(),
    playerId,
    initialBalance: Money.from({ amount, currency: 'BRL' }),
  });
}

function createTransaction(
  wallet: Wallet,
  overrides: Partial<Parameters<typeof WagerTransaction.create>[0]> = {},
): WagerTransaction {
  const id = randomUUID();

  const transaction = WagerTransaction.create({
    id,
    wallet,
    providerId: `provider-${randomUUID()}`,
    externalTransactionId: `external-${randomUUID()}`,
    playerId: wallet.playerId,
    roundId: `round-${randomUUID()}`,
    gameId: `game-${randomUUID()}`,
    kind: WagerTransactionKind.Bet,
    amount: Money.from({ amount: '25.00', currency: 'BRL' }),
    idempotencyKey: `idempotency-${randomUUID()}`,
    payloadHash: `payload-${randomUUID()}`,
    createdAt: new Date(),
    ...overrides,
  });
  transaction.recordResultingBalance(wallet.balance);
  return transaction;
}

function createLedgerEntry(
  wallet: Wallet,
  transaction: WagerTransaction,
  id = randomUUID(),
): WalletLedgerEntry {
  return WalletLedgerEntry.create({
    id,
    wallet,
    transaction,
    type: 'BET',
    direction: 'DEBIT',
    money: Money.from({ amount: '25.00', currency: 'BRL' }),
    balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
    balanceAfter: Money.from({ amount: '75.00', currency: 'BRL' }),
    createdAt: new Date(),
  });
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('wagering repositories with PostgreSQL', () => {
  let orm: MikroORM;
  let unitOfWork: MikroOrmWageringUnitOfWork;
  let walletCreationService: WalletCreationService;

  beforeAll(async () => {
    orm = await MikroORM.init(databaseConfig);
    await orm.getMigrator().up();
    unitOfWork = new MikroOrmWageringUnitOfWork(orm.em);
    walletCreationService = new WalletCreationService(unitOfWork);
  });

  afterAll(async () => {
    await orm?.close(true);
  });

  it('finds and persists wallets, transactions, and ledger entries', async () => {
    const wallet = createWallet();
    const transaction = createTransaction(wallet);
    const ledgerEntry = createLedgerEntry(wallet, transaction);

    await unitOfWork.transaction(async (repositories) => {
      repositories.wallets.save(wallet);
      repositories.wagerTransactions.save(transaction);
      repositories.ledgerEntries.add(ledgerEntry);
    });

    await unitOfWork.transaction(async (repositories) => {
      expect(
        await repositories.wallets.findByPlayerAndCurrency(
          wallet.playerId,
          'BRL',
        ),
      ).not.toBeNull();
      expect(
        await repositories.wallets.findByPlayerAndCurrency(
          '00000000-0000-0000-0000-000000000000',
          'BRL',
        ),
      ).toBeNull();
      expect(
        await repositories.wallets.findByPlayerAndCurrency(
          wallet.playerId,
          'USD',
        ),
      ).toBeNull();
      expect(
        await repositories.wallets.findByPlayerAndCurrencyForUpdate(
          wallet.playerId,
          'BRL',
        ),
      ).not.toBeNull();
      expect(
        await repositories.wagerTransactions.findByIdempotencyKey(
          transaction.idempotencyKey,
        ),
      ).not.toBeNull();
      expect(
        await repositories.wagerTransactions.findByIdempotencyKey(
          'missing-idempotency-key',
        ),
      ).toBeNull();
      expect(
        await repositories.wagerTransactions.findByProviderAndExternalTransactionId(
          transaction.providerId,
          transaction.externalTransactionId,
        ),
      ).not.toBeNull();
      expect(
        await repositories.wagerTransactions.findByProviderAndExternalTransactionId(
          'missing-provider',
          'missing-transaction',
        ),
      ).toBeNull();
      expect(
        await repositories.wagerTransactions.findByProviderAndExternalTransactionId(
          transaction.providerId,
          'missing-transaction',
        ),
      ).toBeNull();
      expect(
        await repositories.wagerTransactions.findByProviderAndExternalTransactionId(
          'missing-provider',
          transaction.externalTransactionId,
        ),
      ).toBeNull();
      const entries = await repositories.ledgerEntries.findByTransactionId(
        transaction.id,
      );
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        id: ledgerEntry.id,
        type: 'BET',
        direction: 'DEBIT',
        moneyAmount: '25.00',
        balanceBeforeAmount: '100.00',
        balanceAfterAmount: '75.00',
      });
      expect(entries[0]?.transaction.id).toBe(transaction.id);
    });

    await unitOfWork.transaction(async (repositories) => {
      const loadedWallet =
        await repositories.wallets.findByPlayerAndCurrencyForUpdate(
          wallet.playerId,
          'BRL',
        );
      if (!loadedWallet) {
        throw new Error('Expected wallet to exist');
      }

      loadedWallet.debit(Money.from({ amount: '25.00', currency: 'BRL' }));
      repositories.wallets.save(loadedWallet);

      const loadedTransaction =
        await repositories.wagerTransactions.findByIdempotencyKey(
          transaction.idempotencyKey,
        );
      if (!loadedTransaction) {
        throw new Error('Expected transaction to exist');
      }

      loadedTransaction.markPendingReference();
      repositories.wagerTransactions.save(loadedTransaction);
    });

    await unitOfWork.transaction(async (repositories) => {
      const updatedTransaction =
        await repositories.wagerTransactions.findByIdempotencyKey(
          transaction.idempotencyKey,
        );
      expect(updatedTransaction?.status).toBe(
        WagerTransactionStatus.PendingReference,
      );
      const updatedWallet = await repositories.wallets.findByPlayerAndCurrency(
        wallet.playerId,
        'BRL',
      );
      expect(updatedWallet?.balance.toJSON().amount).toBe('75.00');
    });
  });

  it('persists an opening transaction and its credit ledger entry', async () => {
    const amount = Money.from({ amount: '25.00', currency: 'BRL' });
    const wallet = createWallet(randomUUID(), amount.toJSON().amount);
    const createdAt = new Date();
    const transaction = WagerTransaction.createOpening({
      id: randomUUID(),
      wallet,
      amount,
      idempotencyKey: `wallet-opening:${wallet.id}`,
      payloadHash: `opening-payload-${randomUUID()}`,
      createdAt,
    });
    const ledgerEntry = WalletLedgerEntry.create({
      id: randomUUID(),
      wallet,
      transaction,
      type: 'OPENING',
      direction: 'CREDIT',
      money: amount,
      balanceBefore: Money.zero('BRL'),
      balanceAfter: amount,
      createdAt,
    });

    await unitOfWork.transaction(async (repositories) => {
      repositories.wallets.save(wallet);
      repositories.wagerTransactions.save(transaction);
      repositories.ledgerEntries.add(ledgerEntry);
    });

    await unitOfWork.transaction(async (repositories) => {
      const persistedTransaction =
        await repositories.wagerTransactions.findByIdempotencyKey(
          transaction.idempotencyKey,
        );
      expect(persistedTransaction).toMatchObject({
        kind: WagerTransactionKind.Opening,
        status: WagerTransactionStatus.Processed,
        providerId: null,
        externalTransactionId: null,
        playerId: null,
        roundId: null,
        gameId: null,
      });

      const entries = await repositories.ledgerEntries.findByTransactionId(
        transaction.id,
      );
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        type: 'OPENING',
        direction: 'CREDIT',
        moneyAmount: '25.00',
        balanceBeforeAmount: '0.00',
        balanceAfterAmount: '25.00',
      });
    });
  });

  it('creates a zero balance wallet without opening records', async () => {
    const playerId = randomUUID();
    const response = await walletCreationService.create({
      playerId,
      initialBalance: { amount: '0', currency: 'BRL' },
    });

    expect(response).toMatchObject({
      id: expect.any(String),
      playerId,
      balance: { amount: '0.00', currency: 'BRL' },
      version: 1,
    });

    await unitOfWork.transaction(async (repositories) => {
      expect(
        await repositories.wallets.findByPlayerAndCurrency(playerId, 'BRL'),
      ).not.toBeNull();
      expect(
        await repositories.wagerTransactions.findByIdempotencyKey(
          `wallet-opening:${response.id}`,
        ),
      ).toBeNull();
    });
  });

  it('creates a positive balance wallet and its opening ledger atomically', async () => {
    const playerId = randomUUID();
    const response = await walletCreationService.create({
      playerId,
      initialBalance: { amount: '42.75', currency: 'BRL' },
    });

    await unitOfWork.transaction(async (repositories) => {
      const wallet = await repositories.wallets.findByPlayerAndCurrency(
        playerId,
        'BRL',
      );
      const transaction =
        await repositories.wagerTransactions.findByIdempotencyKey(
          `wallet-opening:${response.id}`,
        );

      expect(wallet?.balance.toJSON().amount).toBe('42.75');
      expect(transaction?.kind).toBe(WagerTransactionKind.Opening);
      expect(transaction?.status).toBe(WagerTransactionStatus.Processed);
      expect(transaction?.amount.toJSON()).toEqual({
        amount: '42.75',
        currency: 'BRL',
      });

      const entries = transaction
        ? await repositories.ledgerEntries.findByTransactionId(transaction.id)
        : [];
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        type: 'OPENING',
        direction: 'CREDIT',
        moneyAmount: '42.75',
        balanceBeforeAmount: '0.00',
        balanceAfterAmount: '42.75',
      });
    });
  });

  it('rolls back a wallet and opening when a ledger write fails', async () => {
    const playerId = randomUUID();
    const failingUnitOfWork: WageringUnitOfWork = {
      transaction: (work) =>
        unitOfWork.transaction((repositories) =>
          work({
            ...repositories,
            ledgerEntries: {
              ...repositories.ledgerEntries,
              add: (entry) => {
                repositories.ledgerEntries.add(entry);
                throw new Error('ledger write failure');
              },
            },
          }),
        ),
    };
    const failingService = new WalletCreationService(failingUnitOfWork);

    await expect(
      failingService.create({
        playerId,
        initialBalance: { amount: '10.00', currency: 'BRL' },
      }),
    ).rejects.toThrow('ledger write failure');

    await unitOfWork.transaction(async (repositories) => {
      expect(
        await repositories.wallets.findByPlayerAndCurrency(playerId, 'BRL'),
      ).toBeNull();
    });
  });

  it('allows only one concurrent wallet creation for the same player', async () => {
    const playerId = randomUUID();
    const attempts = await Promise.allSettled([
      walletCreationService.create({
        playerId,
        initialBalance: { amount: '10.00', currency: 'BRL' },
      }),
      walletCreationService.create({
        playerId,
        initialBalance: { amount: '20.00', currency: 'BRL' },
      }),
    ]);

    expect(
      attempts.filter((attempt) => attempt.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      attempts.filter((attempt) => attempt.status === 'rejected'),
    ).toHaveLength(1);

    await unitOfWork.transaction(async (repositories) => {
      const wallet = await repositories.wallets.findByPlayerAndCurrency(
        playerId,
        'BRL',
      );
      expect(wallet).not.toBeNull();
      const transactions = wallet
        ? await orm.em.find(WagerTransaction, { wallet: wallet.id })
        : [];
      expect(transactions).toHaveLength(1);
      const entries = transactions[0]
        ? await repositories.ledgerEntries.findByTransactionId(
            transactions[0].id,
          )
        : [];
      expect(entries).toHaveLength(1);
    });
  });

  it('rolls back all writes when the callback fails', async () => {
    const wallet = createWallet();

    await expect(
      unitOfWork.transaction(async (repositories) => {
        repositories.wallets.save(wallet);
        throw new Error('callback failure');
      }),
    ).rejects.toThrow('callback failure');

    await unitOfWork.transaction(async (repositories) => {
      expect(
        await repositories.wallets.findByPlayerAndCurrency(
          wallet.playerId,
          'BRL',
        ),
      ).toBeNull();
    });
  });

  it('rolls back related writes when the database flush fails', async () => {
    const wallet = createWallet();
    const existingTransaction = createTransaction(wallet, {
      idempotencyKey: `duplicate-${randomUUID()}`,
    });
    const conflictingTransactionId = randomUUID();
    const conflictingProviderId = `provider-${randomUUID()}`;
    const conflictingExternalId = `external-${randomUUID()}`;

    await unitOfWork.transaction(async (repositories) => {
      repositories.wallets.save(wallet);
      repositories.wagerTransactions.save(existingTransaction);
    });

    await expect(
      unitOfWork.transaction(async (repositories) => {
        const lockedWallet =
          await repositories.wallets.findByPlayerAndCurrencyForUpdate(
            wallet.playerId,
            'BRL',
          );
        if (!lockedWallet) {
          throw new Error('Expected wallet to exist');
        }

        lockedWallet.credit(Money.from({ amount: '10.00', currency: 'BRL' }));
        repositories.wallets.save(lockedWallet);
        const conflictingTransaction = createTransaction(lockedWallet, {
          id: conflictingTransactionId,
          idempotencyKey: existingTransaction.idempotencyKey,
          providerId: conflictingProviderId,
          externalTransactionId: conflictingExternalId,
        });
        repositories.wagerTransactions.save(conflictingTransaction);
        repositories.ledgerEntries.add(
          createLedgerEntry(lockedWallet, conflictingTransaction),
        );
      }),
    ).rejects.toThrow();

    await unitOfWork.transaction(async (repositories) => {
      const persistedWallet =
        await repositories.wallets.findByPlayerAndCurrency(
          wallet.playerId,
          'BRL',
        );
      expect(persistedWallet?.balance.toJSON().amount).toBe('100.00');
      expect(
        await repositories.wagerTransactions.findByProviderAndExternalTransactionId(
          conflictingProviderId,
          conflictingExternalId,
        ),
      ).toBeNull();
      expect(
        await repositories.ledgerEntries.findByTransactionId(
          conflictingTransactionId,
        ),
      ).toHaveLength(0);
    });
  });

  it('serializes concurrent locks for the same wallet', async () => {
    const wallet = createWallet();
    await unitOfWork.transaction(async (repositories) => {
      repositories.wallets.save(wallet);
    });

    const firstLockAcquired = deferred();
    const releaseFirstLock = deferred();
    const firstTransaction = unitOfWork.transaction(async (repositories) => {
      await repositories.wallets.findByPlayerAndCurrencyForUpdate(
        wallet.playerId,
        'BRL',
      );
      firstLockAcquired.resolve();
      await releaseFirstLock.promise;
    });

    await firstLockAcquired.promise;

    const secondLockStarted = deferred();
    let secondLockAcquired = false;
    const secondTransaction = unitOfWork.transaction(async (repositories) => {
      const lockRequest = repositories.wallets.findByPlayerAndCurrencyForUpdate(
        wallet.playerId,
        'BRL',
      );
      secondLockStarted.resolve();
      await lockRequest;
      secondLockAcquired = true;
    });

    try {
      await secondLockStarted.promise;
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(secondLockAcquired).toBe(false);
    } finally {
      releaseFirstLock.resolve();
    }

    await Promise.all([firstTransaction, secondTransaction]);
    expect(secondLockAcquired).toBe(true);
  });

  it('allows locks on different wallets to proceed independently', async () => {
    const firstWallet = createWallet();
    const secondWallet = createWallet();
    await unitOfWork.transaction(async (repositories) => {
      repositories.wallets.save(firstWallet);
      repositories.wallets.save(secondWallet);
    });

    const firstLockAcquired = deferred();
    const releaseFirstLock = deferred();
    const firstTransaction = unitOfWork.transaction(async (repositories) => {
      await repositories.wallets.findByPlayerAndCurrencyForUpdate(
        firstWallet.playerId,
        'BRL',
      );
      firstLockAcquired.resolve();
      await releaseFirstLock.promise;
    });

    await firstLockAcquired.promise;
    const secondLockAcquired = deferred();
    const secondTransaction = unitOfWork.transaction(async (repositories) => {
      await repositories.wallets.findByPlayerAndCurrencyForUpdate(
        secondWallet.playerId,
        'BRL',
      );
      secondLockAcquired.resolve();
    });

    try {
      const result = await Promise.race([
        secondLockAcquired.promise.then(() => 'acquired'),
        new Promise<'timeout'>((resolve) =>
          setTimeout(() => resolve('timeout'), 2000),
        ),
      ]);
      expect(result).toBe('acquired');
    } finally {
      releaseFirstLock.resolve();
    }

    await Promise.all([firstTransaction, secondTransaction]);
  });

  it('enforces provider identity and ledger uniqueness and immutability', async () => {
    const wallet = createWallet();
    const transaction = createTransaction(wallet);
    const initialEntry = createLedgerEntry(wallet, transaction);

    await unitOfWork.transaction(async (repositories) => {
      repositories.wallets.save(wallet);
      repositories.wagerTransactions.save(transaction);
      repositories.ledgerEntries.add(initialEntry);
    });

    await expect(
      unitOfWork.transaction(async (repositories) => {
        const managedWallet =
          await repositories.wallets.findByPlayerAndCurrency(
            wallet.playerId,
            'BRL',
          );
        if (!managedWallet) {
          throw new Error('Expected wallet to exist');
        }

        repositories.wagerTransactions.save(
          createTransaction(managedWallet, {
            providerId: transaction.providerId,
            externalTransactionId: transaction.externalTransactionId,
          }),
        );
      }),
    ).rejects.toThrow();

    await expect(
      unitOfWork.transaction(async (repositories) => {
        const managedWallet =
          await repositories.wallets.findByPlayerAndCurrency(
            wallet.playerId,
            'BRL',
          );
        const managedTransaction =
          await repositories.wagerTransactions.findByIdempotencyKey(
            transaction.idempotencyKey,
          );
        if (!managedWallet || !managedTransaction) {
          throw new Error('Expected persisted records to exist');
        }

        repositories.ledgerEntries.add(
          createLedgerEntry(managedWallet, managedTransaction, randomUUID()),
        );
      }),
    ).rejects.toThrow();

    const connection = orm.em.getConnection();
    await expect(
      connection.execute(
        'update "wallet_ledger_entries" set "direction" = ? where "id" = ?',
        ['CREDIT', initialEntry.id],
      ),
    ).rejects.toThrow('wallet_ledger_entries is immutable');
    await expect(
      connection.execute('delete from "wallet_ledger_entries" where "id" = ?', [
        initialEntry.id,
      ]),
    ).rejects.toThrow('wallet_ledger_entries is immutable');
  });
});
