import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { MetricsService } from '../common/metrics/metrics.module.js';
import { WalletLedgerEntry } from '../domain/ledger/wallet-ledger-entry.entity.js';
import type {
  WageringRepositories,
  WageringUnitOfWork,
} from '../domain/repositories/wagering-repositories.js';
import { Money } from '../domain/shared/money.js';
import { Wallet } from '../domain/wallet/wallet.entity.js';
import {
  WagerTransaction,
  WagerTransactionKind,
} from '../domain/wagering/wager-transaction.entity.js';
import { WageringTransactionsService } from './wagering-transactions.service.js';

describe('WageringTransactionsService', () => {
  it('hashes the canonical business payload with normalized money', async () => {
    const playerId = randomUUID();
    const wallet = Wallet.open({
      id: randomUUID(),
      playerId,
      initialBalance: Money.from({ amount: '10.00', currency: 'BRL' }),
    });
    const savedWallets: Wallet[] = [];
    const savedTransactions: WagerTransaction[] = [];
    const savedEntries: WalletLedgerEntry[] = [];
    const repositories: WageringRepositories = {
      wallets: {
        findById: async () => null,
        findByIdForUpdate: async () => null,
        findByPlayerAndCurrency: async () => null,
        findByPlayerAndCurrencyForUpdate: async () => wallet,
        save: (savedWallet) => savedWallets.push(savedWallet),
      },
      wagerTransactions: {
        findById: async () => null,
        findByIdempotencyKey: async () => null,
        findByProviderAndExternalTransactionId: async () => null,
        findByProviderAndReferenceExternalTransactionId: async () => [],
        save: (transaction) => savedTransactions.push(transaction),
      },
      ledgerEntries: {
        findByWalletAfter: async () => [],
        findByTransactionId: async () => [],
        findByWallet: async () => [],
        add: (entry) => savedEntries.push(entry),
      },
    };
    const unitOfWork: WageringUnitOfWork = {
      transaction: (work) => work(repositories),
    };
    const metrics = new MetricsService();
    const logger: Pick<StructuredLogger, 'info' | 'warnEvent'> = {
      info: vi.fn(),
      warnEvent: vi.fn(),
    };
    const service = new WageringTransactionsService(
      unitOfWork,
      metrics,
      logger,
    );

    const response = await service.create('key-1', {
      providerId: 'provider-1',
      externalTransactionId: 'external-1',
      playerId,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      amount: { amount: '5', currency: 'BRL' },
    });

    const canonicalPayload =
      `{"amount":{"amount":"5.00","currency":"BRL"},` +
      `"externalTransactionId":"external-1","gameId":"game-1",` +
      `"kind":"BET","playerId":"${playerId}",` +
      `"providerId":"provider-1","roundId":"round-1"}`;

    expect(savedTransactions[0]?.payloadHash).toBe(
      createHash('sha256').update(canonicalPayload, 'utf8').digest('hex'),
    );
    expect(response).toEqual({
      transactionId: savedTransactions[0]?.id,
      status: 'PROCESSED',
      balance: { amount: '5.00', currency: 'BRL' },
      idempotentReplay: false,
    });
    expect(savedWallets).toHaveLength(1);
    expect(savedEntries).toHaveLength(1);
    const metricText = (await metrics.getMetrics()).body;
    expect(metricText).toContain(
      'wagering_transactions_total{status="PROCESSED"} 1',
    );
    expect(metricText).toContain(
      'wagering_transaction_processing_duration_seconds_count 1',
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Wagering transaction request completed.',
      {
        transactionId: savedTransactions[0]?.id,
        walletId: wallet.id,
        providerId: 'provider-1',
      },
    );
  });
});
