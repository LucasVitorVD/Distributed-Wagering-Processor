import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { WalletLedgerEntry } from '../domain/ledger/wallet-ledger-entry.entity.js';
import type {
  LedgerEntryCursor,
  WageringUnitOfWork,
} from '../domain/repositories/wagering-repositories.js';
import { Currency, Money } from '../domain/shared/money.js';
import { WalletNotFoundError } from '../domain/shared/errors.js';
import { Wallet } from '../domain/wallet/wallet.entity.js';
import { WAGERING_UNIT_OF_WORK } from '../infrastructure/persistence/wagering-persistence.module.js';

const DEFAULT_LEDGER_LIMIT = 50;

export interface WalletQueryResponse {
  id: string;
  playerId: string;
  balance: {
    amount: string;
    currency: Currency;
  };
  version: number;
}

interface LedgerEntryResponse {
  id: string;
  transactionId: string;
  type: WalletLedgerEntry['type'];
  direction: WalletLedgerEntry['direction'];
  amount: {
    amount: string;
    currency: Currency;
  };
  balanceBefore: {
    amount: string;
    currency: Currency;
  };
  balanceAfter: {
    amount: string;
    currency: Currency;
  };
  createdAt: string;
}

export interface WalletLedgerResponse {
  items: LedgerEntryResponse[];
  nextCursor: string | null;
  limit: number;
}

interface DecodedLedgerCursor extends LedgerEntryCursor {
  walletId: string;
}

@Injectable()
export class WalletQueryService {
  constructor(
    @Inject(WAGERING_UNIT_OF_WORK)
    private readonly unitOfWork: WageringUnitOfWork,
  ) {}

  async findWallet(walletId: string): Promise<WalletQueryResponse> {
    return this.unitOfWork.transaction(async (repositories) => {
      const wallet = await repositories.wallets.findById(walletId);

      if (!wallet) {
        throw new WalletNotFoundError();
      }

      return this.toWalletResponse(wallet);
    });
  }

  async findLedger(
    walletId: string,
    query: { cursor?: string; limit?: string },
  ): Promise<WalletLedgerResponse> {
    const cursor = query.cursor
      ? this.decodeCursor(query.cursor, walletId)
      : null;
    const limit = query.limit
      ? Number.parseInt(query.limit, 10)
      : DEFAULT_LEDGER_LIMIT;

    return this.unitOfWork.transaction(async (repositories) => {
      const wallet = await repositories.wallets.findById(walletId);

      if (!wallet) {
        throw new WalletNotFoundError();
      }

      const rows = await repositories.ledgerEntries.findByWalletAfter(
        walletId,
        cursor,
        limit + 1,
      );
      const hasMore = rows.length > limit;
      const entries = hasMore ? rows.slice(0, limit) : [...rows];
      const lastEntry = entries.at(-1);

      return {
        items: entries.map((entry) => this.toLedgerEntryResponse(entry)),
        nextCursor:
          hasMore && lastEntry ? this.encodeCursor(walletId, lastEntry) : null,
        limit,
      };
    });
  }

  private toWalletResponse(wallet: Wallet): WalletQueryResponse {
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
    };
  }

  private toLedgerEntryResponse(entry: WalletLedgerEntry): LedgerEntryResponse {
    return {
      id: entry.id,
      transactionId: entry.transactionId,
      type: entry.type,
      direction: entry.direction,
      amount: Money.rehydrate(entry.moneyAmount, entry.moneyCurrency).toJSON(),
      balanceBefore: Money.rehydrate(
        entry.balanceBeforeAmount,
        entry.balanceBeforeCurrency,
      ).toJSON(),
      balanceAfter: Money.rehydrate(
        entry.balanceAfterAmount,
        entry.balanceAfterCurrency,
      ).toJSON(),
      createdAt: entry.createdAt.toISOString(),
    };
  }

  private encodeCursor(walletId: string, entry: WalletLedgerEntry): string {
    const cursor = {
      v: 1,
      walletId,
      createdAt: entry.createdAt.toISOString(),
      id: entry.id,
    };

    return Buffer.from(JSON.stringify(cursor)).toString('base64url');
  }

  private decodeCursor(
    encodedCursor: string,
    walletId: string,
  ): DecodedLedgerCursor {
    const decoded = Buffer.from(encodedCursor, 'base64url').toString('utf8');

    if (Buffer.from(decoded).toString('base64url') !== encodedCursor) {
      throw this.invalidCursor();
    }

    let value: unknown;

    try {
      value = JSON.parse(decoded);
    } catch {
      throw this.invalidCursor();
    }

    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw this.invalidCursor();
    }

    const cursor = value as Record<string, unknown>;
    const keys = Object.keys(cursor);
    const expectedKeys = ['v', 'walletId', 'createdAt', 'id'];
    const createdAt =
      typeof cursor.createdAt === 'string'
        ? new Date(cursor.createdAt)
        : undefined;

    if (
      keys.length !== expectedKeys.length ||
      expectedKeys.some((key) => !Object.hasOwn(cursor, key)) ||
      cursor.v !== 1 ||
      typeof cursor.walletId !== 'string' ||
      !isUUID(cursor.walletId) ||
      cursor.walletId !== walletId ||
      typeof cursor.id !== 'string' ||
      !isUUID(cursor.id) ||
      !createdAt ||
      Number.isNaN(createdAt.getTime()) ||
      createdAt.toISOString() !== cursor.createdAt
    ) {
      throw this.invalidCursor();
    }

    return {
      walletId: cursor.walletId,
      createdAt,
      id: cursor.id,
    };
  }

  private invalidCursor(): BadRequestException {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'O cursor informado é inválido.',
    });
  }
}
