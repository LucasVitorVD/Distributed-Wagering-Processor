import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { Money } from '../shared/money.js';

export type LedgerEntryState = {
  id: string;
  walletId: string;
  transactionId: string;
  direction: 'DEBIT' | 'CREDIT';
  moneyAmount: string;
  moneyCurrency: string;
  balanceBeforeAmount: string;
  balanceBeforeCurrency: string;
  balanceAfterAmount: string;
  balanceAfterCurrency: string;
  createdAt: Date;
};

export type CreateLedgerEntryProps = {
  id: string;
  walletId: string;
  transactionId: string;
  direction: 'DEBIT' | 'CREDIT';
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
};

@Entity()
export class WalletLedgerEntry {
  @PrimaryKey({ type: 'uuid' })
  public readonly id!: string;

  @Property({ type: 'text' })
  public walletId!: string;

  @Property({ type: 'text' })
  public transactionId!: string;

  @Property({ type: 'varchar', length: 10 })
  public direction!: 'DEBIT' | 'CREDIT';

  @Property({ type: 'text', columnType: 'text' })
  public moneyAmount!: string;

  @Property({ type: 'varchar', length: 3 })
  public moneyCurrency!: string;

  @Property({ type: 'text', columnType: 'text' })
  public balanceBeforeAmount!: string;

  @Property({ type: 'varchar', length: 3 })
  public balanceBeforeCurrency!: string;

  @Property({ type: 'text', columnType: 'text' })
  public balanceAfterAmount!: string;

  @Property({ type: 'varchar', length: 3 })
  public balanceAfterCurrency!: string;

  @Property({ type: 'timestamptz' })
  public createdAt!: Date;

  public get money(): Money {
    return Money.rehydrate(this.moneyAmount, this.moneyCurrency);
  }

  public get balanceBefore(): Money {
    return Money.rehydrate(
      this.balanceBeforeAmount,
      this.balanceBeforeCurrency,
    );
  }

  public get balanceAfter(): Money {
    return Money.rehydrate(this.balanceAfterAmount, this.balanceAfterCurrency);
  }

  private constructor(props: CreateLedgerEntryProps) {
    this.id = props.id;
    this.walletId = props.walletId;
    this.transactionId = props.transactionId;
    this.direction = props.direction;
    this.moneyAmount = props.money.toJSON().amount;
    this.moneyCurrency = props.money.currency;
    this.balanceBeforeAmount = props.balanceBefore.toJSON().amount;
    this.balanceBeforeCurrency = props.balanceBefore.currency;
    this.balanceAfterAmount = props.balanceAfter.toJSON().amount;
    this.balanceAfterCurrency = props.balanceAfter.currency;
    this.createdAt = props.createdAt;
  }

  static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    const entry = new WalletLedgerEntry(props);
    if (!entry.isBalanced()) {
      throw new Error(
        `Ledger entry desbalanceado: balanceBefore ${props.balanceBefore.toString()} ` +
          `${props.direction === 'DEBIT' ? '-' : '+'} money ${props.money.toString()} ` +
          `!= balanceAfter ${props.balanceAfter.toString()}`,
      );
    }
    return entry;
  }

  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry({
      id: state.id,
      walletId: state.walletId,
      transactionId: state.transactionId,
      direction: state.direction,
      money: Money.rehydrate(state.moneyAmount, state.moneyCurrency),
      balanceBefore: Money.rehydrate(
        state.balanceBeforeAmount,
        state.balanceBeforeCurrency,
      ),
      balanceAfter: Money.rehydrate(
        state.balanceAfterAmount,
        state.balanceAfterCurrency,
      ),
      createdAt: state.createdAt,
    });
  }

  isBalanced(): boolean {
    const expected =
      this.direction === 'DEBIT'
        ? this.balanceBefore.subtract(this.money)
        : this.balanceBefore.add(this.money);
    return expected.equals(this.balanceAfter);
  }
}
