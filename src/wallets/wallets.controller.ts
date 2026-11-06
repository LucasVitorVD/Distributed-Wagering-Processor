import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CreateWalletDto } from './dto/create-wallet.dto.js';
import {
  WalletIdParamsDto,
  WalletLedgerQueryDto,
} from './dto/wallet-query.dto.js';
import {
  WalletCreationService,
  type CreatedWalletResponse,
} from './wallet-creation.service.js';
import {
  WalletQueryService,
  type WalletLedgerResponse,
  type WalletQueryResponse,
} from './wallet-query.service.js';
import {
  WalletReconciliationService,
  type WalletReconciliationResponse,
} from './wallet-reconciliation.service.js';

@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly walletCreationService: WalletCreationService,
    private readonly walletQueryService: WalletQueryService,
    private readonly walletReconciliationService: WalletReconciliationService,
  ) {}

  @Post()
  create(@Body() request: CreateWalletDto): Promise<CreatedWalletResponse> {
    return this.walletCreationService.create(request);
  }

  @Get(':walletId')
  findWallet(@Param() params: WalletIdParamsDto): Promise<WalletQueryResponse> {
    return this.walletQueryService.findWallet(params.walletId);
  }

  @Get(':walletId/ledger')
  findLedger(
    @Param() params: WalletIdParamsDto,
    @Query() query: WalletLedgerQueryDto,
  ): Promise<WalletLedgerResponse> {
    return this.walletQueryService.findLedger(params.walletId, query);
  }

  @Post(':walletId/reconciliation')
  @HttpCode(HttpStatus.OK)
  reconcile(
    @Param() params: WalletIdParamsDto,
  ): Promise<WalletReconciliationResponse> {
    return this.walletReconciliationService.reconcile(params.walletId);
  }
}
