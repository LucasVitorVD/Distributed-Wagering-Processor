import { Inject, Injectable } from '@nestjs/common';
import { EntityManager, LockMode } from '@mikro-orm/core';
import { WalletLedgerEntry } from '../../../domain/ledger/wallet-ledger-entry.entity.js';
import type {
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

  save(transaction: WagerTransaction): void {
    this.em.persist(transaction);
  }
}

class MikroOrmWalletLedgerEntryRepository implements WalletLedgerEntryRepository {
  constructor(private readonly em: EntityManager) {}

  findByTransactionId(
    transactionId: string,
  ): Promise<readonly WalletLedgerEntry[]> {
    return this.em.find(WalletLedgerEntry, { transaction: transactionId });
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
  ) {}

  transaction<T>(
    work: (repositories: WageringRepositories) => Promise<T>,
  ): Promise<T> {
    return this.em.transactional(async (transactionalEm) => {
      const repositories: WageringRepositories = {
        wallets: new MikroOrmWalletRepository(transactionalEm),
        wagerTransactions: new MikroOrmWagerTransactionRepository(
          transactionalEm,
        ),
        ledgerEntries: new MikroOrmWalletLedgerEntryRepository(transactionalEm),
      };

      return work(repositories);
    });
  }
}
