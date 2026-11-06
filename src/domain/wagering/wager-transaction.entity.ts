import {
  Check,
  Collection,
  Entity,
  ManyToOne,
  Index,
  OneToMany,
  PrimaryKey,
  Property,
  Unique,
  type Rel,
} from '@mikro-orm/core';
import { Wallet } from '../wallet/wallet.entity.js';
import { WalletLedgerEntry } from '../ledger/wallet-ledger-entry.entity.js';
import { type Currency, Money } from '../shared/money.js';
import {
  InvalidResultingBalanceError,
  InvalidAmountError,
  MissingProviderTransactionDataError,
  MissingTransactionReferenceError,
} from '../shared/errors.js';

export enum WagerTransactionKind {
  Opening = 'OPENING',
  Bet = 'BET',
  Win = 'WIN',
  Loss = 'LOSS',
  Refund = 'REFUND',
  Rollback = 'ROLLBACK',
}

export enum WagerTransactionStatus {
  Pending = 'PENDING',
  PendingReference = 'PENDING_REFERENCE',
  Processed = 'PROCESSED',
  Rejected = 'REJECTED',
  Failed = 'FAILED',
}

export enum FailureCode {
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  PROCESSING_TIMEOUT = 'PROCESSING_TIMEOUT',

  INVALID_AMOUNT = 'INVALID_AMOUNT',
  CURRENCY_MISMATCH = 'CURRENCY_MISMATCH',
  INVALID_REFERENCE = 'INVALID_REFERENCE',
  MISSING_REFERENCE = 'MISSING_REFERENCE',
  REVERSAL_WOULD_CAUSE_NEGATIVE_BALANCE = 'REVERSAL_WOULD_CAUSE_NEGATIVE_BALANCE',

  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  DUPLICATE_TRANSACTION = 'DUPLICATE_TRANSACTION',
  IDEMPOTENCY_CONFLICT = 'IDEMPOTENCY_CONFLICT',
}

export type CreateWagerTransactionProps = {
  id: string;
  wallet: Rel<Wallet>;
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  amount: Money;
  idempotencyKey: string;
  payloadHash: string;
  referenceExternalTransactionId?: string;
  createdAt: Date;
};

export type CreateOpeningWagerTransactionProps = {
  id: string;
  wallet: Rel<Wallet>;
  amount: Money;
  idempotencyKey: string;
  payloadHash: string;
  createdAt: Date;
};

type WagerTransactionProps = Omit<
  CreateWagerTransactionProps,
  'providerId' | 'externalTransactionId' | 'playerId' | 'roundId' | 'gameId'
> & {
  providerId?: string | null;
  externalTransactionId?: string | null;
  playerId?: string | null;
  roundId?: string | null;
  gameId?: string | null;
};

export type WagerTransactionState = {
  id: string;
  wallet: Rel<Wallet>;
  providerId: string | null;
  externalTransactionId: string | null;
  playerId: string | null;
  roundId: string | null;
  gameId: string | null;
  kind: WagerTransactionKind;
  amountAmount: string;
  amountCurrency: Currency;
  resultingBalanceAmount: string;
  resultingBalanceCurrency: Currency;
  status: WagerTransactionStatus;
  idempotencyKey: string;
  payloadHash: string;
  referenceExternalTransactionId: string | null;
  referenceTransactionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  processedAt: Date | null;
  failureCode: FailureCode | null;
};

@Entity({ tableName: 'wager_transactions' })
@Check({
  name: 'chk_wager_amount_positive',
  expression: (columns) => `${columns.amountAmount} > 0`,
})
@Check({
  name: 'chk_wager_provider_fields_by_kind',
  expression: (columns) =>
    `(${columns.kind} = 'OPENING' and ${columns.providerId} is null and ${columns.externalTransactionId} is null and ${columns.playerId} is null and ${columns.roundId} is null and ${columns.gameId} is null) or (${columns.kind} <> 'OPENING' and ${columns.providerId} is not null and ${columns.externalTransactionId} is not null and ${columns.playerId} is not null and ${columns.roundId} is not null and ${columns.gameId} is not null)`,
})
@Check({
  name: 'chk_wager_result_balance_non_negative',
  expression: (columns) => `${columns.resultingBalanceAmount} >= 0`,
})
@Check({
  name: 'chk_wager_result_balance_currency',
  expression: (columns) =>
    `${columns.resultingBalanceCurrency} = ${columns.amountCurrency}`,
})
@Unique({
  name: 'uq_wager_transactions_provider_external',
  properties: ['providerId', 'externalTransactionId'],
})
@Index({
  name: 'idx_wager_transactions_wallet',
  properties: ['wallet'],
})
export class WagerTransaction {
  @PrimaryKey({ type: 'uuid' })
  public readonly id!: string;

  @ManyToOne(() => Wallet, { updateRule: 'no action' })
  public readonly wallet!: Rel<Wallet>;

  @OneToMany(() => WalletLedgerEntry, (entry) => entry.transaction)
  public ledgerEntries = new Collection<WalletLedgerEntry>(this);

  @Property({ columnType: 'varchar(10)' })
  public readonly kind!: WagerTransactionKind;

  @Property({ columnType: 'numeric(18,2)' })
  private amountAmount!: string;

  @Property({ columnType: 'varchar(3)' })
  private amountCurrency!: Currency;

  @Property({
    columnType: 'numeric(18,2)',
    fieldName: 'resulting_balance_amount',
  })
  private resultingBalanceAmount!: string;

  @Property({
    columnType: 'varchar(3)',
    fieldName: 'resulting_balance_currency',
  })
  private resultingBalanceCurrency!: Currency;

  @Property({ columnType: 'varchar(30)', fieldName: 'status' })
  private _status!: WagerTransactionStatus;

  @Property({ type: 'text', unique: true })
  public readonly idempotencyKey!: string;

  @Property({ type: 'text' })
  public readonly payloadHash!: string;

  @Property({
    type: 'text',
    nullable: true,
    fieldName: 'reference_external_transaction_id',
  })
  public readonly referenceExternalTransactionId?: string;

  @Property({
    type: 'uuid',
    nullable: true,
    fieldName: 'reference_transaction_id',
  })
  private _referenceTransactionId?: string;

  @Property({ type: 'text', nullable: true })
  public readonly providerId?: string;

  @Property({ type: 'text', nullable: true })
  public readonly externalTransactionId?: string;

  @Property({ type: 'text', nullable: true })
  public readonly playerId?: string;

  @Property({ type: 'text', nullable: true })
  public readonly roundId?: string;

  @Property({ type: 'text', nullable: true })
  public readonly gameId?: string;

  @Property({ columnType: 'timestamptz', onCreate: () => new Date() })
  public readonly createdAt!: Date;

  @Property({
    columnType: 'timestamptz',
    fieldName: 'updated_at',
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
  })
  private _updatedAt!: Date;

  @Property({
    columnType: 'timestamptz',
    nullable: true,
    fieldName: 'processed_at',
  })
  private _processedAt?: Date;

  @Property({
    columnType: 'varchar(50)',
    nullable: true,
    fieldName: 'failure_code',
  })
  private _failureCode?: FailureCode;

  private constructor(
    props: WagerTransactionProps,
    state: Pick<
      WagerTransactionState,
      | 'status'
      | 'referenceTransactionId'
      | 'updatedAt'
      | 'processedAt'
      | 'failureCode'
    >,
  ) {
    this.id = props.id;
    this.wallet = props.wallet;
    this.kind = props.kind;
    this.amountAmount = props.amount.toJSON().amount;
    this.amountCurrency = props.amount.currency;
    this._status = state.status;
    this.idempotencyKey = props.idempotencyKey;
    this.payloadHash = props.payloadHash;
    this.referenceExternalTransactionId =
      props.referenceExternalTransactionId ?? undefined;
    this._referenceTransactionId = state.referenceTransactionId ?? undefined;
    this.createdAt = props.createdAt;
    this._updatedAt = state.updatedAt;
    this._processedAt = state.processedAt ?? undefined;
    this._failureCode = state.failureCode ?? undefined;
    this.providerId = props.providerId ?? undefined;
    this.externalTransactionId = props.externalTransactionId ?? undefined;
    this.playerId = props.playerId ?? undefined;
    this.roundId = props.roundId ?? undefined;
    this.gameId = props.gameId ?? undefined;
  }

  static create(props: CreateWagerTransactionProps): WagerTransaction {
    const requiresReference =
      props.kind === WagerTransactionKind.Refund ||
      props.kind === WagerTransactionKind.Rollback;

    if (requiresReference && !props.referenceExternalTransactionId?.trim()) {
      throw new MissingTransactionReferenceError(props.kind);
    }

    if (!props.amount.isPositive()) {
      throw new InvalidAmountError();
    }

    if (props.kind === WagerTransactionKind.Opening) {
      throw new Error('OPENING transactions can only be created internally');
    }

    if (
      !props.providerId.trim() ||
      !props.externalTransactionId.trim() ||
      !props.playerId.trim() ||
      !props.roundId.trim() ||
      !props.gameId.trim()
    ) {
      throw new MissingProviderTransactionDataError();
    }

    return new WagerTransaction(props, {
      status: WagerTransactionStatus.Pending,
      referenceTransactionId: null,
      updatedAt: props.createdAt,
      processedAt: null,
      failureCode: null,
    });
  }

  static createOpening(
    props: CreateOpeningWagerTransactionProps,
  ): WagerTransaction {
    if (!props.amount.isPositive()) {
      throw new InvalidAmountError();
    }

    const transaction = new WagerTransaction(
      {
        ...props,
        kind: WagerTransactionKind.Opening,
      },
      {
        status: WagerTransactionStatus.Processed,
        referenceTransactionId: null,
        updatedAt: props.createdAt,
        processedAt: props.createdAt,
        failureCode: null,
      },
    );
    transaction.recordResultingBalance(props.amount);
    return transaction;
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    const transaction = new WagerTransaction(
      {
        id: state.id,
        wallet: state.wallet,
        providerId: state.providerId,
        externalTransactionId: state.externalTransactionId,
        playerId: state.playerId,
        roundId: state.roundId,
        gameId: state.gameId,
        kind: state.kind,
        amount: Money.rehydrate(state.amountAmount, state.amountCurrency),
        idempotencyKey: state.idempotencyKey,
        payloadHash: state.payloadHash,
        referenceExternalTransactionId:
          state.referenceExternalTransactionId ?? undefined,
        createdAt: state.createdAt,
      },
      {
        status: state.status,
        referenceTransactionId: state.referenceTransactionId,
        updatedAt: state.updatedAt,
        processedAt: state.processedAt,
        failureCode: state.failureCode,
      },
    );
    transaction.recordResultingBalance(
      Money.rehydrate(
        state.resultingBalanceAmount,
        state.resultingBalanceCurrency,
      ),
    );
    return transaction;
  }

  recordResultingBalance(balance: Money): void {
    if (balance.currency !== this.amountCurrency || balance.isNegative()) {
      throw new InvalidResultingBalanceError();
    }

    this.resultingBalanceAmount = balance.toJSON().amount;
    this.resultingBalanceCurrency = balance.currency;
  }

  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.ensureCanTransition();

    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = at;
    this._updatedAt = at;
  }

  markPendingReference(): void {
    if (this._status === WagerTransactionStatus.PendingReference) {
      return;
    }

    this.ensureCanTransition();

    this._status = WagerTransactionStatus.PendingReference;
    this._updatedAt = new Date();
  }

  reject(code: FailureCode): void {
    this.ensureCanTransition();

    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._updatedAt = new Date();
  }

  fail(code: FailureCode): void {
    this.ensureCanTransition();

    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._updatedAt = new Date();
  }

  private ensureCanTransition(): void {
    const allowedStatuses = [
      WagerTransactionStatus.Pending,
      WagerTransactionStatus.PendingReference,
    ];

    if (!allowedStatuses.includes(this._status)) {
      throw new Error(
        `Cannot transition transaction from status ${this._status}`,
      );
    }
  }

  isTerminal(): boolean {
    return [
      WagerTransactionStatus.Processed,
      WagerTransactionStatus.Rejected,
      WagerTransactionStatus.Failed,
    ].includes(this._status);
  }

  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  requiresReference(): boolean {
    return (
      this.kind === WagerTransactionKind.Refund ||
      this.kind === WagerTransactionKind.Rollback
    );
  }

  matchesPayload(hash: string): boolean {
    return this.payloadHash === hash;
  }

  ledgerDirectionFor(
    reference?: WagerTransaction,
  ): 'CREDIT' | 'DEBIT' | undefined {
    switch (this.kind) {
      case WagerTransactionKind.Opening:
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
        return 'CREDIT';

      case WagerTransactionKind.Bet:
        return 'DEBIT';

      case WagerTransactionKind.Loss:
        return undefined;

      case WagerTransactionKind.Rollback:
        if (!reference) {
          throw new Error('ROLLBACK requires a reference transaction');
        }

        switch (reference.kind) {
          case WagerTransactionKind.Bet:
            return 'CREDIT';

          case WagerTransactionKind.Win:
          case WagerTransactionKind.Refund:
            return 'DEBIT';

          default:
            throw new Error('Invalid transaction type for ROLLBACK');
        }
    }
  }

  get amount(): Money {
    return Money.rehydrate(this.amountAmount, this.amountCurrency);
  }

  get resultingBalance(): Money {
    return Money.rehydrate(
      this.resultingBalanceAmount,
      this.resultingBalanceCurrency,
    );
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }
}
