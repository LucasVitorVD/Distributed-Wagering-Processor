import { Inject, Injectable, Optional } from '@nestjs/common';
import { EntityManager, LockMode } from '@mikro-orm/core';
import { MetricsService } from '../../../common/metrics/metrics.module.js';
import { WalletLedgerEntry } from '../../../domain/ledger/wallet-ledger-entry.entity.js';
import type {
  LedgerEntryCursor,
  WalletLedgerEntryRepository,
  WagerTransactionRepository,
  WageringRepositories,
  WageringUnitOfWork,
  WalletRepository,
} from '../../../domain/repositories/wagering-repositories.js';
import { Wallet } from '../../../domain/wallet/wallet.entity.js';
import { WagerTransaction } from '../../../domain/wagering/wager-transaction.entity.js';
import type { Currency } from '../../../domain/shared/money.js';

class MikroOrmWalletRepository implements WalletRepository {
  constructor(private readonly em: EntityManager) {}

  findById(id: string): Promise<Wallet | null> {
    return this.em.findOne(Wallet, { id });
  }

  findByIdForUpdate(id: string): Promise<Wallet | null> {
    return this.em.findOne(
      Wallet,
      { id },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
  }

  findByPlayerAndCurrency(
    playerId: string,
    currency: Currency,
  ): Promise<Wallet | null> {
    return this.em.findOne(Wallet, { playerId, balanceCurrency: currency });
  }

  findByPlayerAndCurrencyForUpdate(
    playerId: string,
    currency: Currency,
  ): Promise<Wallet | null> {
    return this.em.findOne(
      Wallet,
      { playerId, balanceCurrency: currency },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
  }

  save(wallet: Wallet): void {
    this.em.persist(wallet);
  }
}

class MikroOrmWagerTransactionRepository implements WagerTransactionRepository {
  constructor(private readonly em: EntityManager) {}

  findById(id: string): Promise<WagerTransaction | null> {
    return this.em.findOne(WagerTransaction, { id });
  }

  findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<WagerTransaction | null> {
    return this.em.findOne(WagerTransaction, { idempotencyKey });
  }

  findByProviderAndExternalTransactionId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    return this.em.findOne(WagerTransaction, {
      providerId,
      externalTransactionId,
    });
  }

  findByProviderAndReferenceExternalTransactionId(
    providerId: string,
    referenceExternalTransactionId: string,
  ): Promise<readonly WagerTransaction[]> {
    return this.em.find(WagerTransaction, {
      providerId,
      referenceExternalTransactionId,
    });
  }

  save(transaction: WagerTransaction): void {
    this.em.persist(transaction);
  }
}

class MikroOrmWalletLedgerEntryRepository implements WalletLedgerEntryRepository {
  constructor(private readonly em: EntityManager) {}

  findByWalletAfter(
    walletId: string,
    cursor: LedgerEntryCursor | null,
    limit: number,
  ): Promise<readonly WalletLedgerEntry[]> {
    return this.em.find(
      WalletLedgerEntry,
      cursor
        ? {
            wallet: walletId,
            $or: [
              { createdAt: { $lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { $lt: cursor.id } },
            ],
          }
        : { wallet: walletId },
      {
        orderBy: { createdAt: 'DESC', id: 'DESC' },
        limit,
      },
    );
  }

  findByTransactionId(
    transactionId: string,
  ): Promise<readonly WalletLedgerEntry[]> {
    return this.em.find(WalletLedgerEntry, { transaction: transactionId });
  }

  findByWallet(walletId: string): Promise<readonly WalletLedgerEntry[]> {
    return this.em.find(WalletLedgerEntry, { wallet: walletId });
  }

  add(entry: WalletLedgerEntry): void {
    this.em.persist(entry);
  }
}

@Injectable()
export class MikroOrmWageringUnitOfWork implements WageringUnitOfWork {
  constructor(
    @Inject(EntityManager)
    private readonly em: EntityManager,
    @Optional()
    @Inject(MetricsService)
    private readonly metricsService: MetricsService = new MetricsService(),
  ) {}

  transaction<T>(
    work: (repositories: WageringRepositories) => Promise<T>,
  ): Promise<T> {
    return this.em
      .transactional(async (transactionalEm) => {
        const repositories: WageringRepositories = {
          wallets: new MikroOrmWalletRepository(transactionalEm),
          wagerTransactions: new MikroOrmWagerTransactionRepository(
            transactionalEm,
          ),
          ledgerEntries: new MikroOrmWalletLedgerEntryRepository(
            transactionalEm,
          ),
        };

        return work(repositories);
      })
      .catch((error: unknown) => {
        if (this.isLockConflict(error)) {
          this.metricsService.recordLockConflict();
        }
        throw error;
      });
  }

  private isLockConflict(error: unknown): boolean {
    let current: unknown = error;

    while (typeof current === 'object' && current !== null) {
      if (
        'code' in current &&
        typeof current.code === 'string' &&
        ['40P01', '55P03', '40001'].includes(current.code)
      ) {
        return true;
      }
      current = 'cause' in current ? current.cause : undefined;
    }

    return false;
  }
}
