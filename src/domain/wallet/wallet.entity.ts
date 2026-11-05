import { Entity } from "@mikro-orm/core";
import { type Currency, Money } from "../shared/money.js";
import { PrimaryKey, Property } from "@mikro-orm/core";

interface WalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
}

@Entity()
export class Wallet {

  @PrimaryKey({ columnType: "uuid" })
  public readonly id!: string

  @Property()
  public readonly playerId!: string

  @Property({ columnType: "numeric(18, 2)" })
  private balanceAmount!: string
  
  @Property({ columnType: "varchar", length: 3 })
  public readonly balanceCurrency!: Currency

  @Property({ version: true })
  private _version: number

  @Property({ columnType: "timestamp", onCreate: () => new Date() })
  public readonly _createdAt!: Date

  @Property({ columnType: "timestamp", onCreate: () => new Date(), onUpdate: () => new Date() })
  private _updatedAt!: Date

  private constructor(id: string, playerId: string, balanceAmount: string, balanceCurrency: Currency) {
    this.id = id;
    this.playerId = playerId;
    this.balanceAmount = balanceAmount;
    this.balanceCurrency = balanceCurrency;
  }

  static open(props: WalletProps): Wallet {
    if (props.initialBalance.isNegative()) {
      throw new Error("Initial balance cannot be negative");
    }

    return new Wallet(
      props.id, 
      props.playerId, 
      props.initialBalance.toJSON().amount,
      props.initialBalance.currency
    );
  }

  credit(amount: Money): Money {
    if (!amount.isPositive()) {
      throw new Error("Amount must be positive");
    }

    if (this.balanceCurrency !== amount.currency) {
      throw new Error("Currency mismatch");
    }

    const newBalance = this.balance.add(amount);

    this.balanceAmount = newBalance.toJSON().amount;

    return newBalance;
  }

  debit(amount: Money): Money {
    if (!amount.isPositive()) {
      throw new Error("Amount must be positive");
    }

    if (this.balanceCurrency !== amount.currency) {
      throw new Error("Currency mismatch");
    }

    const currentBalance = this.balance;

    if (currentBalance.isLessThan(amount)) {
      throw new Error("Insufficient balance");
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