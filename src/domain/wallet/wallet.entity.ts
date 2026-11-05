import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { Money } from '../shared/money.js';
import {
  NegativeBalanceError,
  WalletCurrencyMismatchError,
} from '../shared/errors.js';

export enum LedgerDirection {
  Debit = 'DEBIT',
  Credit = 'CREDIT',
}

export type BalanceChangeResult = {
  balanceBefore: Money;
  balanceAfter: Money;
  direction: LedgerDirection;
  money: Money;
  referenceTransactionId: string | undefined;
};

/**
 * Aggregate Root da carteira do jogador.
 *
 * O saldo é persistido em duas colunas (`balance_amount`, `balance_currency`)
 * para evitar dependência de tipos monetários do ORM. O `Money` é reconstruído
 * a partir delas via getter.
 *
 * Todas as mudanças de saldo passam por `debit`/`credit`, que garantem:
 * - moeda compatível com a carteira
 * - saldo nunca negativo
 * - version incrementado somente quando o saldo muda
 */
@Entity()
export class Wallet {
  @PrimaryKey({ type: 'uuid' })
  public readonly id!: string;

  @Property({ type: 'text' })
  public readonly playerId!: string;

  @Property({ type: 'varchar', length: 3 })
  public readonly currency!: string;

  @Property({ type: 'text', columnType: 'text' })
  public balanceAmount!: string;

  @Property({ type: 'varchar', length: 3 })
  public balanceCurrency!: string;

  @Property({ type: 'number', version: true })
  public version!: number;

  @Property({ type: 'timestamptz' })
  public readonly createdAt!: Date;

  @Property({ type: 'timestamptz', onUpdate: () => new Date() })
  public updatedAt!: Date;

  /** Não persistido: derivado de balanceAmount + balanceCurrency. */
  public get balance(): Money {
    return Money.rehydrate(this.balanceAmount, this.balanceCurrency);
  }

  private constructor(
    id: string,
    playerId: string,
    currency: string,
    balanceAmount: string,
    balanceCurrency: string,
    version: number,
    createdAt: Date,
    updatedAt: Date,
  ) {
    this.id = id;
    this.playerId = playerId;
    this.currency = currency;
    this.balanceAmount = balanceAmount;
    this.balanceCurrency = balanceCurrency;
    this.version = version;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  /**
   * Cria uma nova carteira. Nasce com version = 1.
   */
  static open(props: {
    id: string;
    playerId: string;
    currency: string;
    initialBalance: Money;
  }): Wallet {
    const now = new Date();
    return new Wallet(
      props.id,
      props.playerId,
      props.currency,
      props.initialBalance.toJSON().amount,
      props.initialBalance.currency,
      1,
      now,
      now,
    );
  }

  /**
   * Reconstrução a partir da persistência. Não revalida transições de negócio.
   */
  static rehydrate(state: {
    id: string;
    playerId: string;
    currency: string;
    balanceAmount: string;
    balanceCurrency: string;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balanceAmount,
      state.balanceCurrency,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  private assertSameCurrency(money: Money): void {
    if (this.currency !== money.currency) {
      throw new WalletCurrencyMismatchError(this.currency, money.currency);
    }
  }

  /**
   * Débito na carteira. Lança se a moeda não bater ou se o saldo ficar negativo.
   * Retorna o resultado da mudança de saldo (para o ledger ser criado pelo use case).
   */
  debit(amount: Money, referenceTransactionId?: string): BalanceChangeResult {
    this.assertSameCurrency(amount);

    const balanceBefore = this.balance;
    const balanceAfter = balanceBefore.subtract(amount);

    if (balanceAfter.isNegative()) {
      throw new NegativeBalanceError(this.id);
    }

    this.balanceAmount = balanceAfter.toJSON().amount;
    this.balanceCurrency = balanceAfter.currency;
    this.version += 1;
    this.updatedAt = new Date();

    return {
      balanceBefore,
      balanceAfter,
      direction: LedgerDirection.Debit,
      money: amount,
      referenceTransactionId,
    };
  }

  /**
   * Crédito na carteira. Lança se a moeda não bater.
   */
  credit(amount: Money, referenceTransactionId?: string): BalanceChangeResult {
    this.assertSameCurrency(amount);

    const balanceBefore = this.balance;
    const balanceAfter = balanceBefore.add(amount);

    this.balanceAmount = balanceAfter.toJSON().amount;
    this.balanceCurrency = balanceAfter.currency;
    this.version += 1;
    this.updatedAt = new Date();

    return {
      balanceBefore,
      balanceAfter,
      direction: LedgerDirection.Credit,
      money: amount,
      referenceTransactionId,
    };
  }
}
