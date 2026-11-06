import { Module } from '@nestjs/common';
import { WageringPersistenceModule } from '../infrastructure/persistence/wagering-persistence.module.js';
import { WageringTransactionsController } from './wagering-transactions.controller.js';
import { WageringTransactionsService } from './wagering-transactions.service.js';

@Module({
  imports: [WageringPersistenceModule],
  controllers: [WageringTransactionsController],
  providers: [WageringTransactionsService],
})
export class WageringTransactionsModule {}
