
import {
  Entity,
  ManyToOne,
  PrimaryKey,
  Property,
  type Rel,
} from "@mikro-orm/core";

import { type Currency, Money } from "../shared/money.js";
import {
  InvalidLedgerAmountError,
  LedgerCurrencyMismatchError,
  NegativeLedgerBalanceError,
  UnbalancedLedgerEntryError,
} from "../shared/errors.js";
import { Wallet } from "../wallet/wallet.entity.js";

export type LedgerEntryDirection = "DEBIT" | "CREDIT";

export type LedgerEntryType =
  | "BET"
  | "WIN"
  | "LOSS"
  | "REFUND"
  | "ROLLBACK";

export type LedgerEntryState = {
  id: string;
  walletId: string;
  transactionId: string;
  type: LedgerEntryType;
  direction: LedgerEntryDirection;
  moneyAmount: string;
  moneyCurrency: Currency;
  balanceBeforeAmount: string;
  balanceBeforeCurrency: Currency;
  balanceAfterAmount: string;
  balanceAfterCurrency: Currency;
  createdAt: Date;
};

export type CreateLedgerEntryProps = {
  id: string;
  wallet: Rel<Wallet>;
  transactionId: string;
  type: LedgerEntryType;
  direction: LedgerEntryDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
};

@Entity()
export class WalletLedgerEntry {
  @PrimaryKey({ type: "uuid" })
  public readonly id!: string;

  @ManyToOne(() => Wallet)
  public readonly wallet!: Rel<Wallet>;

  @Property({ type: "text" })
  public readonly transactionId!: string;

  @Property({ columnType: "varchar(10)" })
  public readonly type!: LedgerEntryType;

  @Property({ columnType: "varchar(10)" })
  public readonly direction!: LedgerEntryDirection;

  @Property({ columnType: "numeric(18,2)" })
  public readonly moneyAmount!: string;

  @Property({ columnType: "varchar(3)" })
  public readonly moneyCurrency!: Currency;

  @Property({ columnType: "numeric(18,2)" })
  public readonly balanceBeforeAmount!: string;

  @Property({ columnType: "varchar(3)" })
  public readonly balanceBeforeCurrency!: Currency;

  @Property({ columnType: "numeric(18,2)" })
  public readonly balanceAfterAmount!: string;

  @Property({ columnType: "varchar(3)" })
  public readonly balanceAfterCurrency!: Currency;

  @Property({ columnType: "timestamptz" })
  public readonly createdAt!: Date;

  private constructor(props: CreateLedgerEntryProps) {
    this.id = props.id;
    this.wallet = props.wallet;
    this.transactionId = props.transactionId;
    this.type = props.type;
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
    if (!props.money.isPositive() || props.money.isZero()) {
      throw new InvalidLedgerAmountError();
    }

    if (
      props.money.currency !== props.balanceBefore.currency ||
      props.money.currency !== props.balanceAfter.currency
    ) {
      const balanceCurrency =
        props.money.currency !== props.balanceBefore.currency
          ? props.balanceBefore.currency
          : props.balanceAfter.currency;
      throw new LedgerCurrencyMismatchError(
        balanceCurrency,
        props.money.currency,
      );
    }

    if (
      props.balanceBefore.isNegative() ||
      props.balanceAfter.isNegative()
    ) {
      throw new NegativeLedgerBalanceError();
    }

    const entry = new WalletLedgerEntry(props);

    if (!entry.isBalanced()) {
      throw new UnbalancedLedgerEntryError();
    }

    return entry;
  }

  static rehydrate(
    state: LedgerEntryState,
    wallet: Rel<Wallet>,
  ): WalletLedgerEntry {
    return new WalletLedgerEntry({
      id: state.id,
      wallet,
      transactionId: state.transactionId,
      type: state.type,
      direction: state.direction,
      money: Money.rehydrate(
        state.moneyAmount,
        state.moneyCurrency,
      ),
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
      this.direction === "DEBIT"
        ? this.balanceBefore.subtract(this.money)
        : this.balanceBefore.add(this.money);

    return expected.equals(this.balanceAfter);
  }

  get money(): Money {
    return Money.rehydrate(
      this.moneyAmount,
      this.moneyCurrency,
    );
  }

  get balanceBefore(): Money {
    return Money.rehydrate(
      this.balanceBeforeAmount,
      this.balanceBeforeCurrency,
    );
  }

  get balanceAfter(): Money {
    return Money.rehydrate(
      this.balanceAfterAmount,
      this.balanceAfterCurrency,
    );
  }
}