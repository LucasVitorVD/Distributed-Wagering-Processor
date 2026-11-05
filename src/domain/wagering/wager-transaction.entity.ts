import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { Money } from '../shared/money.js';
import { InvalidTransactionStateError } from '../shared/errors.js';

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

export type FailureCode =
  | 'INSUFFICIENT_BALANCE'
  | 'DUPLICATE_REFERENCE_REVERSAL'
  | 'MISSING_REFERENCE'
  | 'INVALID_REFERENCE'
  | 'WALLET_CURRENCY_MISMATCH'
  | 'INTERNAL_ERROR';

export type CreateWagerTransactionProps = {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt: Date;
};

export type WagerTransactionState = {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  moneyAmount: string;
  moneyCurrency: string;
  referenceExternalTransactionId: string | null;
  createdAt: Date;
  status: WagerTransactionStatus;
  referenceTransactionId: string | null;
  failureCode: FailureCode | null;
  processedAt: Date | null;
};

export type LedgerDirectionResult = {
  direction: 'DEBIT' | 'CREDIT';
  affectsBalance: boolean;
};

/**
 * Transações de aposta. Nasce em PENDING. As transições de estado são
 * explícitas e PROCESSED / REJECTED / FAILED são terminais.
 *
 * Regras de referência:
 * - REFUND só referencia BET.
 * - ROLLBACK referencia BET, WIN ou REFUND.
 * - Uma referência não pode ser revertida duas vezes pelo mesmo tipo.
 */
@Entity()
export class WagerTransaction {
  @PrimaryKey({ type: 'uuid' })
  public readonly id!: string;

  @Property({ type: 'text' })
  public providerId!: string;

  @Property({ type: 'text' })
  public externalTransactionId!: string;

  @Property({ type: 'text' })
  public idempotencyKey!: string;

  @Property({ type: 'text' })
  public payloadHash!: string;

  @Property({ type: 'text' })
  public walletId!: string;

  @Property({ type: 'text' })
  public playerId!: string;

  @Property({ type: 'text' })
  public roundId!: string;

  @Property({ type: 'text' })
  public gameId!: string;

  @Property({ type: 'varchar', length: 20 })
  public kind!: WagerTransactionKind;

  @Property({ type: 'text', columnType: 'text' })
  public moneyAmount!: string;

  @Property({ type: 'varchar', length: 3 })
  public moneyCurrency!: string;

  @Property({ type: 'text', nullable: true })
  public referenceExternalTransactionId!: string | null;

  @Property({ type: 'timestamptz' })
  public createdAt!: Date;

  @Property({ type: 'varchar', length: 30 })
  public status!: WagerTransactionStatus;

  @Property({ type: 'text', nullable: true })
  public referenceTransactionId!: string | null;

  @Property({ type: 'varchar', length: 50, nullable: true })
  public failureCode!: FailureCode | null;

  @Property({ type: 'timestamptz', nullable: true })
  public processedAt!: Date | null;

  /** Não persistido: Money reconstruído a partir das colunas amount/currency. */
  public get money(): Money {
    return Money.rehydrate(this.moneyAmount, this.moneyCurrency);
  }

  private constructor(props: CreateWagerTransactionProps & {
    status: WagerTransactionStatus;
  }) {
    this.id = props.id;
    this.providerId = props.providerId;
    this.externalTransactionId = props.externalTransactionId;
    this.idempotencyKey = props.idempotencyKey;
    this.payloadHash = props.payloadHash;
    this.walletId = props.walletId;
    this.playerId = props.playerId;
    this.roundId = props.roundId;
    this.gameId = props.gameId;
    this.kind = props.kind;
    this.moneyAmount = props.money.toJSON().amount;
    this.moneyCurrency = props.money.currency;
    this.referenceExternalTransactionId =
      props.referenceExternalTransactionId ?? null;
    this.createdAt = props.createdAt;
    this.status = props.status;
    this.referenceTransactionId = null;
    this.failureCode = null;
    this.processedAt = null;
  }

  static create(props: CreateWagerTransactionProps): WagerTransaction {
    const requiresRef =
      props.kind === WagerTransactionKind.Refund ||
      props.kind === WagerTransactionKind.Rollback;

    if (requiresRef && !props.referenceExternalTransactionId) {
      throw new Error(
        `Transação ${props.kind} exige referenceExternalTransactionId`,
      );
    }

    // OPENING é interno: não pode ser submetido por API nem fila
    if (props.kind === WagerTransactionKind.Opening) {
      throw new Error('OPENING é uma transação interna e não pode ser submetida');
    }

    return new WagerTransaction({ ...props, status: WagerTransactionStatus.Pending });
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    const tx = new WagerTransaction({
      id: state.id,
      providerId: state.providerId,
      externalTransactionId: state.externalTransactionId,
      idempotencyKey: state.idempotencyKey,
      payloadHash: state.payloadHash,
      walletId: state.walletId,
      playerId: state.playerId,
      roundId: state.roundId,
      gameId: state.gameId,
      kind: state.kind,
      money: Money.rehydrate(state.moneyAmount, state.moneyCurrency),
      referenceExternalTransactionId: state.referenceExternalTransactionId ?? undefined,
      createdAt: state.createdAt,
      status: state.status,
    });
    tx.referenceTransactionId = state.referenceTransactionId;
    tx.failureCode = state.failureCode;
    tx.processedAt = state.processedAt;
    return tx;
  }

  get isTerminal(): boolean {
    return (
      this.status === WagerTransactionStatus.Processed ||
      this.status === WagerTransactionStatus.Rejected ||
      this.status === WagerTransactionStatus.Failed
    );
  }

  get affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  get requiresReference(): boolean {
    return (
      this.kind === WagerTransactionKind.Refund ||
      this.kind === WagerTransactionKind.Rollback
    );
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  /**
   * Direção do lançamento no ledger, considerando a transação de referência
   * (para ROLLBACK, inverte a direção da referência).
   */
  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirectionResult {
    if (this.kind === WagerTransactionKind.Bet) {
      return { direction: 'DEBIT', affectsBalance: true };
    }
    if (this.kind === WagerTransactionKind.Win) {
      return { direction: 'CREDIT', affectsBalance: true };
    }
    if (this.kind === WagerTransactionKind.Loss) {
      return { direction: 'DEBIT', affectsBalance: false };
    }
    if (this.kind === WagerTransactionKind.Refund) {
      return { direction: 'CREDIT', affectsBalance: true };
    }
    if (this.kind === WagerTransactionKind.Rollback) {
      if (!reference) {
        return { direction: 'DEBIT', affectsBalance: true };
      }
      const refDir = reference.ledgerDirectionFor();
      return {
        direction: refDir.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT',
        affectsBalance: refDir.affectsBalance,
      };
    }
    return { direction: 'DEBIT', affectsBalance: true };
  }

  /**
   * Transição para PROCESSED. Só permitido se não for terminal.
   */
  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    if (this.isTerminal) {
      throw new InvalidTransactionStateError(
        this.id,
        this.status,
        WagerTransactionStatus.Processed,
      );
    }
    this.status = WagerTransactionStatus.Processed;
    this.referenceTransactionId = referenceTransactionId ?? null;
    this.processedAt = at;
  }

  markPendingReference(): void {
    if (this.isTerminal) {
      throw new InvalidTransactionStateError(
        this.id,
        this.status,
        WagerTransactionStatus.PendingReference,
      );
    }
    this.status = WagerTransactionStatus.PendingReference;
  }

  reject(code: FailureCode): void {
    if (this.isTerminal) {
      throw new InvalidTransactionStateError(
        this.id,
        this.status,
        WagerTransactionStatus.Rejected,
      );
    }
    this.status = WagerTransactionStatus.Rejected;
    this.failureCode = code;
    this.processedAt = new Date();
  }

  fail(code: FailureCode): void {
    if (this.isTerminal) {
      throw new InvalidTransactionStateError(
        this.id,
        this.status,
        WagerTransactionStatus.Failed,
      );
    }
    this.status = WagerTransactionStatus.Failed;
    this.failureCode = code;
    this.processedAt = new Date();
  }
}
