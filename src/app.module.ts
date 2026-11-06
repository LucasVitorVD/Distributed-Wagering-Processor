import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import config from './config/mikro-orm.config.js';
import { WageringPersistenceModule } from './infrastructure/persistence/wagering-persistence.module.js';
import { WalletsModule } from './wallets/wallets.module.js';

@Module({
  imports: [
    MikroOrmModule.forRoot(config),
    WageringPersistenceModule,
    WalletsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
