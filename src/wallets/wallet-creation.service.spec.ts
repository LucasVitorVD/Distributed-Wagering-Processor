import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { WalletLedgerEntry } from '../domain/ledger/wallet-ledger-entry.entity.js';
import type {
  WageringRepositories,
  WageringUnitOfWork,
} from '../domain/repositories/wagering-repositories.js';
import { WagerTransactionKind } from '../domain/wagering/wager-transaction.entity.js';
import { WalletCreationService } from './wallet-creation.service.js';

describe('WalletCreationService', () => {
  function createService() {
    const wallets: Parameters<WageringRepositories['wallets']['save']>[0][] =
      [];
    const transactions: Parameters<
      WageringRepositories['wagerTransactions']['save']
    >[0][] = [];
    const entries: WalletLedgerEntry[] = [];
    const repositories: WageringRepositories = {
      wallets: {
        findById: async () => null,
        findByIdForUpdate: async () => null,
        findByPlayerAndCurrency: async () => null,
        findByPlayerAndCurrencyForUpdate: async () => null,
        save: (wallet) => wallets.push(wallet),
      },
      wagerTransactions: {
        findById: async () => null,
        findByIdempotencyKey: async () => null,
        findByProviderAndExternalTransactionId: async () => null,
        findByProviderAndReferenceExternalTransactionId: async () => [],
        save: (transaction) => transactions.push(transaction),
      },
      ledgerEntries: {
        findByWalletAfter: async () => [],
        findByTransactionId: async () => [],
        findByWallet: async () => [],
        add: (entry) => entries.push(entry),
      },
    };
    const unitOfWork: WageringUnitOfWork = {
      transaction: (work) => work(repositories),
    };

    return {
      service: new WalletCreationService(unitOfWork),
      wallets,
      transactions,
      entries,
    };
  }

  it('cria somente a carteira quando o saldo inicial é zero', async () => {
    const { service, wallets, transactions, entries } = createService();
    const playerId = randomUUID();

    const response = await service.create({
      playerId,
      initialBalance: { amount: '0', currency: 'BRL' },
    });

    expect(response).toMatchObject({
      playerId,
      balance: { amount: '0.00', currency: 'BRL' },
      version: 1,
    });
    expect(wallets).toHaveLength(1);
    expect(transactions).toHaveLength(0);
    expect(entries).toHaveLength(0);
  });

  it('cria abertura processada e lançamento de crédito para saldo positivo', async () => {
    const { service, wallets, transactions, entries } = createService();

    const response = await service.create({
      playerId: randomUUID(),
      initialBalance: { amount: '25.5', currency: 'BRL' },
    });

    const wallet = wallets[0];
    const transaction = transactions[0];
    const ledgerEntry = entries[0];

    expect(response.balance).toEqual({ amount: '25.50', currency: 'BRL' });
    expect(wallet?.balance.toJSON().amount).toBe('25.50');
    expect(transaction).toMatchObject({
      kind: WagerTransactionKind.Opening,
      status: 'PROCESSED',
      idempotencyKey: `wallet-opening:${wallet?.id}`,
    });
    expect(transaction?.providerId).toBeUndefined();
    expect(ledgerEntry).toMatchObject({
      type: 'OPENING',
      direction: 'CREDIT',
      moneyAmount: '25.50',
      balanceBeforeAmount: '0.00',
      balanceAfterAmount: '25.50',
    });
    expect(transaction?.payloadHash).toBe(
      createHash('sha256')
        .update(
          JSON.stringify({
            walletId: wallet?.id,
            kind: 'OPENING',
            amount: '25.50',
            currency: 'BRL',
          }),
        )
        .digest('hex'),
    );
  });
});
