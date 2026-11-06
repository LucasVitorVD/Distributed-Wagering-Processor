import { Module } from '@nestjs/common';
import { MetricsModule } from '../common/metrics/metrics.module.js';
import { WageringPersistenceModule } from '../infrastructure/persistence/wagering-persistence.module.js';
import { WalletCreationService } from './wallet-creation.service.js';
import { WalletQueryService } from './wallet-query.service.js';
import { WalletReconciliationService } from './wallet-reconciliation.service.js';
import { WalletsController } from './wallets.controller.js';

@Module({
  imports: [WageringPersistenceModule, MetricsModule],
  controllers: [WalletsController],
  providers: [
    WalletCreationService,
    WalletQueryService,
    WalletReconciliationService,
  ],
})
export class WalletsModule {}
