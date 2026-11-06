import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { WalletLedgerEntry } from '../domain/ledger/wallet-ledger-entry.entity.js';
import { WAGERING_UNIT_OF_WORK } from '../infrastructure/persistence/wagering-persistence.module.js';
import type { WageringUnitOfWork } from '../domain/repositories/wagering-repositories.js';
import { Currency, Money } from '../domain/shared/money.js';
import { Wallet } from '../domain/wallet/wallet.entity.js';
import {
  WagerTransaction,
  WagerTransactionKind,
} from '../domain/wagering/wager-transaction.entity.js';
import type { CreateWalletDto } from './dto/create-wallet.dto.js';

export interface CreatedWalletResponse {
  id: string;
  playerId: string;
  balance: {
    amount: string,
    currency: Currency
  };
  version: number;
}

@Injectable()
export class WalletCreationService {
  constructor(
    @Inject(WAGERING_UNIT_OF_WORK)
    private readonly unitOfWork: WageringUnitOfWork,
  ) { }

  async create(request: CreateWalletDto): Promise<CreatedWalletResponse> {
    const initialBalance = Money.from({
      amount: request.initialBalance.amount,
      currency: request.initialBalance.currency,
    });
    const wallet = Wallet.open({
      id: randomUUID(),
      playerId: request.playerId,
      initialBalance,
    });
    const createdAt = new Date();

    await this.unitOfWork.transaction(async (repositories) => {
      repositories.wallets.save(wallet);

      if (initialBalance.isZero()) {
        return;
      }

      const transactionId = randomUUID();
      const amount = initialBalance.toJSON().amount;
      const payloadHash = createHash('sha256')
        .update(
          JSON.stringify({
            walletId: wallet.id,
            kind: WagerTransactionKind.Opening,
            amount,
            currency: initialBalance.currency,
          }),
        )
        .digest('hex');
      const transaction = WagerTransaction.createOpening({
        id: transactionId,
        wallet,
        amount: initialBalance,
        idempotencyKey: `wallet-opening:${wallet.id}`,
        payloadHash,
        createdAt,
      });
      const ledgerEntry = WalletLedgerEntry.create({
        id: randomUUID(),
        wallet,
        transaction,
        type: 'OPENING',
        direction: 'CREDIT',
        money: initialBalance,
        balanceBefore: Money.zero('BRL'),
        balanceAfter: initialBalance,
        createdAt,
      });

      repositories.wagerTransactions.save(transaction);
      repositories.ledgerEntries.add(ledgerEntry);
    });

    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: {
        amount: wallet.balance.toJSON().amount,
        currency: wallet.balanceCurrency
      },
      version: wallet.version ?? 1,
    };
  }
}
