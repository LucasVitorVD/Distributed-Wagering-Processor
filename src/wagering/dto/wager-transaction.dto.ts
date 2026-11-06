import { Type } from 'class-transformer';
import {
  Allow,
  IsDefined,
  IsIn,
  IsString,
  IsUUID,
  Length,
  Matches,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
  type ValidationArguments,
} from 'class-validator';
import { WagerTransactionKind } from '../../domain/wagering/wager-transaction.entity.js';

const REFERENCE_KINDS = [
  WagerTransactionKind.Refund,
  WagerTransactionKind.Rollback,
];

export class WagerTransactionIdParamsDto {
  @IsUUID(undefined, {
    message: 'O campo transactionId deve ser um UUID válido.',
  })
  transactionId!: string;
}

export class ProviderTransactionParamsDto {
  @IsString({ message: 'O campo providerId deve ser um texto.' })
  @Length(1, 255, {
    message: 'O campo providerId deve ter entre 1 e 255 caracteres.',
  })
  @Matches(/\S/, { message: 'O campo providerId não pode ser vazio.' })
  providerId!: string;

  @IsString({
    message: 'O campo externalTransactionId deve ser um texto.',
  })
  @Length(1, 255, {
    message: 'O campo externalTransactionId deve ter entre 1 e 255 caracteres.',
  })
  @Matches(/\S/, {
    message: 'O campo externalTransactionId não pode ser vazio.',
  })
  externalTransactionId!: string;
}

export class WagerTransactionAmountDto {
  @IsString({ message: 'O valor deve ser um texto decimal.' })
  @Matches(/^(?=.*[1-9])(0|[1-9]\d{0,15})(\.\d{1,2})?$/, {
    message:
      'O valor deve ser positivo, ter até duas casas decimais e não exceder 9999999999999999.99.',
  })
  amount!: string;

  @IsIn(['BRL'], { message: 'A moeda aceita para a transação é BRL.' })
  currency!: 'BRL';
}

@ValidatorConstraint({ name: 'transactionReference', async: false })
class TransactionReferenceConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const body = args.object as CreateWagerTransactionDto;
    const isRequired = REFERENCE_KINDS.includes(body.kind);
    const reference = body.referenceExternalTransactionId;

    if (isRequired) {
      return (
        typeof reference === 'string' &&
        reference.length >= 1 &&
        reference.length <= 255 &&
        reference.trim().length > 0
      );
    }

    return reference === undefined;
  }

  defaultMessage(): string {
    return 'A referência externa é obrigatória apenas para REFUND e ROLLBACK.';
  }
}

export class CreateWagerTransactionDto {
  @IsString({ message: 'O campo providerId deve ser um texto.' })
  @Length(1, 255, {
    message: 'O campo providerId deve ter entre 1 e 255 caracteres.',
  })
  @Matches(/\S/, { message: 'O campo providerId não pode ser vazio.' })
  providerId!: string;

  @IsString({
    message: 'O campo externalTransactionId deve ser um texto.',
  })
  @Length(1, 255, {
    message: 'O campo externalTransactionId deve ter entre 1 e 255 caracteres.',
  })
  @Matches(/\S/, {
    message: 'O campo externalTransactionId não pode ser vazio.',
  })
  externalTransactionId!: string;

  @IsUUID(undefined, {
    message: 'O campo playerId deve ser um UUID válido.',
  })
  playerId!: string;

  @IsString({ message: 'O campo roundId deve ser um texto.' })
  @Length(1, 255, {
    message: 'O campo roundId deve ter entre 1 e 255 caracteres.',
  })
  @Matches(/\S/, { message: 'O campo roundId não pode ser vazio.' })
  roundId!: string;

  @IsString({ message: 'O campo gameId deve ser um texto.' })
  @Length(1, 255, {
    message: 'O campo gameId deve ter entre 1 e 255 caracteres.',
  })
  @Matches(/\S/, { message: 'O campo gameId não pode ser vazio.' })
  gameId!: string;

  @IsIn(
    [
      WagerTransactionKind.Bet,
      WagerTransactionKind.Win,
      WagerTransactionKind.Loss,
      WagerTransactionKind.Refund,
      WagerTransactionKind.Rollback,
    ],
    { message: 'O tipo de transação não é aceito.' },
  )
  @Validate(TransactionReferenceConstraint)
  kind!: WagerTransactionKind;

  @IsDefined({ message: 'O campo amount é obrigatório.' })
  @ValidateNested()
  @Type(() => WagerTransactionAmountDto)
  amount!: WagerTransactionAmountDto;

  @Allow()
  referenceExternalTransactionId?: string;
}
