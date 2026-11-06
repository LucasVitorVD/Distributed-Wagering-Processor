import { describe, expect, it, vi } from 'vitest';
import { WalletLedgerEntry } from '../domain/ledger/wallet-ledger-entry.entity.js';
import type {
  WageringRepositories,
  WageringUnitOfWork,
} from '../domain/repositories/wagering-repositories.js';
import { Money } from '../domain/shared/money.js';
import { Wallet } from '../domain/wallet/wallet.entity.js';
import { WagerTransaction } from '../domain/wagering/wager-transaction.entity.js';
import { WalletReconciliationService } from './wallet-reconciliation.service.js';

describe('WalletReconciliationService', () => {
  function createFixture(storedAmount = '25.50', ledgerAmount = '25.50') {
    const wallet = Wallet.open({
      id: '0192f291-27dd-7d3f-8071-5f8685deef37',
      playerId: 'player-1',
      initialBalance: Money.from({
        amount: storedAmount,
        currency: 'BRL',
      }),
    });
    const transaction = WagerTransaction.createOpening({
      id: '0192f291-27dd-7d3f-8071-5f8685deef38',
      wallet,
      amount: Money.from({ amount: ledgerAmount, currency: 'BRL' }),
      idempotencyKey: `wallet-opening:${wallet.id}`,
      payloadHash: 'opening-payload-hash',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const entry = WalletLedgerEntry.create({
      id: '0192f291-27dd-7d3f-8071-5f8685deef39',
      wallet,
      transaction,
      type: 'OPENING',
      direction: 'CREDIT',
      money: Money.from({ amount: ledgerAmount, currency: 'BRL' }),
      balanceBefore: Money.zero('BRL'),
      balanceAfter: Money.from({ amount: ledgerAmount, currency: 'BRL' }),
      createdAt: transaction.createdAt,
    });
    const metrics = {
      recordWalletReconciliationMismatch: vi.fn(),
    };
    const logger: Pick<StructuredLogger, 'warnEvent'> = {
      warnEvent: vi.fn(),
    };
    const repositories: WageringRepositories = {
      wallets: {
        findById: async () => wallet,
        findByIdForUpdate: async () => wallet,
        findByPlayerAndCurrency: async () => wallet,
        findByPlayerAndCurrencyForUpdate: async () => wallet,
        save: () => undefined,
      },
      wagerTransactions: {
        findById: async () => transaction,
        findByIdempotencyKey: async () => transaction,
        findByProviderAndExternalTransactionId: async () => transaction,
        findByProviderAndReferenceExternalTransactionId: async () => [],
        save: () => undefined,
      },
      ledgerEntries: {
        findByWalletAfter: async () => [],
        findByTransactionId: async () => [entry],
        findByWallet: async () => [entry],
        add: () => undefined,
      },
    };
    const unitOfWork: WageringUnitOfWork = {
      transaction: (work) => work(repositories),
    };

    return {
      wallet,
      metrics,
      service: new WalletReconciliationService(unitOfWork, metrics, logger),
      logger,
    };
  }

  it('calculates the ledger balance and reports a consistent wallet', async () => {
    const { metrics, service } = createFixture();

    await expect(
      service.reconcile('0192f291-27dd-7d3f-8071-5f8685deef37'),
    ).resolves.toEqual({
      walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
      storedBalance: { amount: '25.50', currency: 'BRL' },
      calculatedBalance: { amount: '25.50', currency: 'BRL' },
      difference: { amount: '0.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 1,
    });
    expect(metrics.recordWalletReconciliationMismatch).not.toHaveBeenCalled();
  });

  it('reports and counts mismatches without changing the stored balance', async () => {
    const { wallet, metrics, service, logger } = createFixture(
      '25.50',
      '20.00',
    );
    const response = await service.reconcile(wallet.id);

    expect(response).toEqual({
      walletId: wallet.id,
      storedBalance: { amount: '25.50', currency: 'BRL' },
      calculatedBalance: { amount: '20.00', currency: 'BRL' },
      difference: { amount: '-5.50', currency: 'BRL' },
      consistent: false,
      checkedEntries: 1,
    });
    expect(wallet.balance.toJSON()).toEqual({
      amount: '25.50',
      currency: 'BRL',
    });
    expect(metrics.recordWalletReconciliationMismatch).toHaveBeenCalledOnce();
    expect(logger.warnEvent).toHaveBeenCalledWith(
      'Wallet reconciliation detected a balance mismatch.',
      { walletId: wallet.id },
    );
  });
});
