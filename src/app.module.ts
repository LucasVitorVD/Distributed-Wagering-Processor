import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import config from './config/mikro-orm.config.js';
import { WageringPersistenceModule } from './infrastructure/persistence/wagering-persistence.module.js';
import { WalletsModule } from './wallets/wallets.module.js';
import { WageringTransactionsModule } from './wagering/wagering-transactions.module.js';
import { HealthModule } from './health/health.module.js';
import { MetricsModule } from './common/metrics/metrics.module.js';

@Module({
  imports: [
    MikroOrmModule.forRoot(config),
    WageringPersistenceModule,
    WalletsModule,
    WageringTransactionsModule,
    HealthModule,
    MetricsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
