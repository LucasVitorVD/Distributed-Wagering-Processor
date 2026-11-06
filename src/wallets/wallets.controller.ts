import { Body, Controller, Post } from '@nestjs/common';
import { CreateWalletDto } from './dto/create-wallet.dto.js';
import {
  WalletCreationService,
  type CreatedWalletResponse,
} from './wallet-creation.service.js';

@Controller('wallets')
export class WalletsController {
  constructor(private readonly walletCreationService: WalletCreationService) {}

  @Post()
  create(@Body() request: CreateWalletDto): Promise<CreatedWalletResponse> {
    return this.walletCreationService.create(request);
  }
}
