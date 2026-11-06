import type { WalletLedgerEntry } from '../ledger/wallet-ledger-entry.entity.js';
import type { Currency } from '../shared/money.js';
import type { Wallet } from '../wallet/wallet.entity.js';
import type { WagerTransaction } from '../wagering/wager-transaction.entity.js';

export interface WalletRepository {
  findById(id: string): Promise<Wallet | null>;

  findByIdForUpdate(id: string): Promise<Wallet | null>;

  findByPlayerAndCurrency(
    playerId: string,
    currency: Currency,
  ): Promise<Wallet | null>;

  findByPlayerAndCurrencyForUpdate(
    playerId: string,
    currency: Currency,
  ): Promise<Wallet | null>;

  save(wallet: Wallet): void;
}

export interface WagerTransactionRepository {
  findById(id: string): Promise<WagerTransaction | null>;

  findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<WagerTransaction | null>;

  findByProviderAndExternalTransactionId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null>;

  findByProviderAndReferenceExternalTransactionId(
    providerId: string,
    referenceExternalTransactionId: string,
  ): Promise<readonly WagerTransaction[]>;

  save(transaction: WagerTransaction): void;
}

export interface WalletLedgerEntryRepository {
  findByWalletAfter(
    walletId: string,
    cursor: LedgerEntryCursor | null,
    limit: number,
  ): Promise<readonly WalletLedgerEntry[]>;

  findByTransactionId(
    transactionId: string,
  ): Promise<readonly WalletLedgerEntry[]>;

  findByWallet(walletId: string): Promise<readonly WalletLedgerEntry[]>;

  add(entry: WalletLedgerEntry): void;
}

export interface LedgerEntryCursor {
  createdAt: Date;
  id: string;
}

export interface WageringRepositories {
  wallets: WalletRepository;
  wagerTransactions: WagerTransactionRepository;
  ledgerEntries: WalletLedgerEntryRepository;
}

export interface WageringUnitOfWork {
  transaction<T>(
    work: (repositories: WageringRepositories) => Promise<T>,
  ): Promise<T>;
}
