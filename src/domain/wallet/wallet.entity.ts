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
