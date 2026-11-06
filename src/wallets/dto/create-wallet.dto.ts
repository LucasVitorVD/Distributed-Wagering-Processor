import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';

export class InitialBalanceDto {
  @IsString({ message: 'O valor do saldo inicial deve ser um texto decimal.' })
  @Matches(/^\s*(0|[1-9]\d{0,15})(\.\d{1,2})?\s*$/, {
    message:
      'O valor deve ser positivo ou zero, ter até duas casas decimais e não exceder 9999999999999999.99.',
  })
  amount!: string;

  @IsIn(['BRL'], { message: 'A moeda aceita para a carteira é BRL.' })
  currency!: 'BRL';
}

export class CreateWalletDto {
  @IsUUID(undefined, { message: 'O campo playerId deve ser um UUID válido.' })
  playerId!: string;

  @IsDefined({ message: 'O campo initialBalance é obrigatório.' })
  @IsObject({ message: 'O campo initialBalance deve ser um objeto.' })
  @ValidateNested()
  @Type(() => InitialBalanceDto)
  initialBalance!: InitialBalanceDto;
}
