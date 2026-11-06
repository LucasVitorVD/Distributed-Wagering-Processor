import { Inject, Injectable } from '@nestjs/common';
import { WalletLedgerEntry } from '../domain/ledger/wallet-ledger-entry.entity.js';
import type { WageringUnitOfWork } from '../domain/repositories/wagering-repositories.js';
import { Currency, Money } from '../domain/shared/money.js';
import { WalletNotFoundError } from '../domain/shared/errors.js';
import { WAGERING_UNIT_OF_WORK } from '../infrastructure/persistence/wagering-persistence.module.js';
import { MetricsService } from '../common/metrics/metrics.module.js';
import { StructuredLogger } from '../common/observability/structured-logger.js';

export interface WalletReconciliationMetrics {
  recordWalletReconciliationMismatch(): void;
}

export interface WalletReconciliationLogger {
  warnEvent(message: string, fields?: { walletId?: string | null }): void;
}

export interface WalletReconciliationResponse {
  walletId: string;
  storedBalance: {
    amount: string;
    currency: Currency;
  };
  calculatedBalance: {
    amount: string;
    currency: Currency;
  };
  difference: {
    amount: string;
    currency: Currency;
  };
  consistent: boolean;
  checkedEntries: number;
}

@Injectable()
export class WalletReconciliationService {
  constructor(
    @Inject(WAGERING_UNIT_OF_WORK)
    private readonly unitOfWork: WageringUnitOfWork,
    @Inject(MetricsService)
    private readonly metricsService: WalletReconciliationMetrics,
    @Inject(StructuredLogger)
    private readonly logger: WalletReconciliationLogger,
  ) {}

  async reconcile(walletId: string): Promise<WalletReconciliationResponse> {
    return this.unitOfWork.transaction(async (repositories) => {
      const wallet = await repositories.wallets.findByIdForUpdate(walletId);
      if (!wallet) {
        throw new WalletNotFoundError();
      }

      const entries = await repositories.ledgerEntries.findByWallet(walletId);
      const calculatedBalance = this.calculateBalance(
        entries,
        wallet.balanceCurrency,
      );
      const difference = calculatedBalance.subtract(wallet.balance);
      const consistent = difference.isZero();

      if (!consistent) {
        this.logger.warnEvent(
          'Wallet reconciliation detected a balance mismatch.',
          { walletId: wallet.id },
        );
        this.metricsService.recordWalletReconciliationMismatch();
      }

      return {
        walletId: wallet.id,
        storedBalance: wallet.balance.toJSON(),
        calculatedBalance: calculatedBalance.toJSON(),
        difference: difference.toJSON(),
        consistent,
        checkedEntries: entries.length,
      };
    });
  }

  private calculateBalance(
    entries: readonly WalletLedgerEntry[],
    currency: Currency,
  ): Money {
    return entries.reduce((balance, entry) => {
      const amount = Money.rehydrate(entry.moneyAmount, entry.moneyCurrency);
      return entry.direction === 'CREDIT'
        ? balance.add(amount)
        : balance.subtract(amount);
    }, Money.zero(currency));
  }
}
