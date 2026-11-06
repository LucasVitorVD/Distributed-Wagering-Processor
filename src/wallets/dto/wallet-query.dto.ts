import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class WalletIdParamsDto {
  @IsUUID(undefined, { message: 'O campo walletId deve ser um UUID válido.' })
  walletId!: string;
}

export class WalletLedgerQueryDto {
  @IsOptional()
  @IsString({ message: 'O cursor deve ser um texto.' })
  @MaxLength(512, { message: 'O cursor não pode exceder 512 caracteres.' })
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'O cursor deve usar o formato Base64URL.',
  })
  cursor?: string;

  @IsOptional()
  @IsString({ message: 'O limite deve ser um número inteiro entre 1 e 100.' })
  @Matches(/^(?:[1-9]|[1-9]\d|100)$/, {
    message: 'O limite deve ser um número inteiro entre 1 e 100.',
  })
  limit?: string;
}
