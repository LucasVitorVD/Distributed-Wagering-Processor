import { Module } from '@nestjs/common';
import { WageringPersistenceModule } from '../infrastructure/persistence/wagering-persistence.module.js';
import { WalletCreationService } from './wallet-creation.service.js';
import { WalletQueryService } from './wallet-query.service.js';
import { WalletsController } from './wallets.controller.js';

@Module({
  imports: [WageringPersistenceModule],
  controllers: [WalletsController],
  providers: [WalletCreationService, WalletQueryService],
})
export class WalletsModule {}
