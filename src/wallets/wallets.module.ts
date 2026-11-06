import { Module } from '@nestjs/common';
import { WageringPersistenceModule } from '../infrastructure/persistence/wagering-persistence.module.js';
import { WalletCreationService } from './wallet-creation.service.js';
import { WalletsController } from './wallets.controller.js';

@Module({
  imports: [WageringPersistenceModule],
  controllers: [WalletsController],
  providers: [WalletCreationService],
})
export class WalletsModule {}
