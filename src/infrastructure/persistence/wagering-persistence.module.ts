import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { WalletLedgerEntry } from '../../domain/ledger/wallet-ledger-entry.entity.js';
import { Wallet } from '../../domain/wallet/wallet.entity.js';
import { WagerTransaction } from '../../domain/wagering/wager-transaction.entity.js';
import { MikroOrmWageringUnitOfWork } from './mikro-orm/wagering-unit-of-work.js';

export const WAGERING_UNIT_OF_WORK = Symbol('WAGERING_UNIT_OF_WORK');

@Module({
  imports: [
    MikroOrmModule.forFeature([Wallet, WagerTransaction, WalletLedgerEntry]),
  ],
  providers: [
    MikroOrmWageringUnitOfWork,
    {
      provide: WAGERING_UNIT_OF_WORK,
      useExisting: MikroOrmWageringUnitOfWork,
    },
  ],
  exports: [WAGERING_UNIT_OF_WORK],
})
export class WageringPersistenceModule {}
