import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import {
  ProviderTransactionParamsDto,
  WagerTransactionIdParamsDto,
  CreateWagerTransactionDto,
} from './dto/wager-transaction.dto.js';
import {
  WageringTransactionsService,
  type WagerTransactionResponse,
  type WagerTransactionWriteResponse,
} from './wagering-transactions.service.js';

@Controller()
export class WageringTransactionsController {
  constructor(
    private readonly wageringTransactionsService: WageringTransactionsService,
  ) {}

  @Get('wagering/transactions/:transactionId')
  findById(
    @Param() params: WagerTransactionIdParamsDto,
  ): Promise<WagerTransactionResponse> {
    return this.wageringTransactionsService.findById(params.transactionId);
  }

  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  findByProviderIdentity(
    @Param() params: ProviderTransactionParamsDto,
  ): Promise<WagerTransactionResponse> {
    return this.wageringTransactionsService.findByProviderIdentity(
      params.providerId,
      params.externalTransactionId,
    );
  }

  @Post('wagering/transactions')
  @HttpCode(200)
  create(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() request: CreateWagerTransactionDto,
  ): Promise<WagerTransactionWriteResponse> {
    return this.wageringTransactionsService.create(idempotencyKey, request);
  }
}
