import { Check, Collection, Entity, OneToMany, Unique } from '@mikro-orm/core';
import { type Currency, Money } from '../shared/money.js';
import { PrimaryKey, Property } from '@mikro-orm/core';
import {
  NegativeBalanceError,
  WalletCurrencyMismatchError,
  InvalidAmountError,
  InvalidInitialBalanceError,
} from '../shared/errors.js';
import { WagerTransaction } from '../wagering/wager-transaction.entity.js';
import { WalletLedgerEntry } from '../ledger/wallet-ledger-entry.entity.js';

interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
}

@Entity({ tableName: 'wallets' })
@Unique({
  name: 'uq_wallets_player_currency',
  properties: ['playerId', 'balanceCurrency'],
})
@Check({
  name: 'chk_wallets_balance_non_negative',
  expression: (columns) => `${columns.balanceAmount} >= 0`,
})
export class Wallet {
  @PrimaryKey({ columnType: 'uuid' })
  public readonly id!: string;

  @Property({ columnType: 'uuid' })
  public readonly playerId!: string;

  @Property({ columnType: 'numeric(18, 2)' })
  private balanceAmount!: string;

  @Property({ columnType: 'varchar(3)' })
  public readonly balanceCurrency!: Currency;

  @Property({ version: true, fieldName: 'version' })
  private _version!: number;

  @Property({
    columnType: 'timestamptz',
    fieldName: 'created_at',
    onCreate: () => new Date(),
  })
  public readonly _createdAt!: Date;

  @Property({
    columnType: 'timestamptz',
    fieldName: 'updated_at',
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
  })
  private _updatedAt!: Date;

  @OneToMany(() => WagerTransaction, (transaction) => transaction.wallet)
  public transactions = new Collection<WagerTransaction>(this);

  @OneToMany(() => WalletLedgerEntry, (entry) => entry.wallet)
  public ledgerEntries = new Collection<WalletLedgerEntry>(this);

  private constructor(
    id: string,
    playerId: string,
    balanceAmount: string,
    balanceCurrency: Currency,
  ) {
    this.id = id;
    this.playerId = playerId;
    this.balanceAmount = balanceAmount;
    this.balanceCurrency = balanceCurrency;
  }

  static open(props: OpenWalletProps): Wallet {
    if (props.initialBalance.isNegative()) {
      throw new InvalidInitialBalanceError();
    }

    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.toJSON().amount,
      props.initialBalance.currency,
    );
  }

  credit(amount: Money): Money {
    if (!amount.isPositive()) {
      throw new InvalidAmountError();
    }

    if (this.balanceCurrency !== amount.currency) {
      throw new WalletCurrencyMismatchError(
        this.balanceCurrency,
        amount.currency,
      );
    }

    const newBalance = this.balance.add(amount);

    this.balanceAmount = newBalance.toJSON().amount;

    return newBalance;
  }

  debit(amount: Money): Money {
    if (!amount.isPositive()) {
      throw new InvalidAmountError();
    }

    if (this.balanceCurrency !== amount.currency) {
      throw new WalletCurrencyMismatchError(
        this.balanceCurrency,
        amount.currency,
      );
    }

    const currentBalance = this.balance;

    if (currentBalance.isLessThan(amount)) {
      throw new NegativeBalanceError(this.id);
    }

    const newBalance = currentBalance.subtract(amount);

    this.balanceAmount = newBalance.toJSON().amount;

    return newBalance;
  }

  get balance(): Money {
    return Money.rehydrate(this.balanceAmount, this.balanceCurrency);
  }

  get version(): number {
    return this._version;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }
}
