import { Decimal } from "decimal.js";

export type Currency = "BRL" | "USD" | "EUR";

export class InvalidMoneyError extends Error {
  public readonly code = "INVALID_MONEY";

  constructor(amount: unknown, reason: string) {
    super(`Valor monetário inválido ${JSON.stringify(amount)}: ${reason}`);
    this.name = "InvalidMoneyError";
  }
}

export class DifferentCurrencyError extends Error {
  public readonly code = "DIFFERENT_CURRENCY";

  constructor(a: Currency, b: Currency) {
    super(`Moedas incompatíveis: ${a} vs ${b}`);
    this.name = "DifferentCurrencyError";
  }
}

const DECIMAL_PLACES = 2;
const SCIENTIFIC_NOTATION = /[eE]/;

export interface MoneyProps {
  amount: string;
  currency: Currency;
}

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: Currency,
  ) {}

  static from(props: MoneyProps): Money {
    const { amount, currency } = props;

    if (typeof amount !== "string" || amount.trim() === "") {
      throw new InvalidMoneyError(amount, "string vazia ou não é uma string");
    }

    const trimmed = amount.trim();

    if (SCIENTIFIC_NOTATION.test(trimmed)) {
      throw new InvalidMoneyError(amount, "notação científica não é permitida");
    }

    const decimalPart = trimmed.split(".")[1] ?? "";
    if (decimalPart.length > DECIMAL_PLACES) {
      throw new InvalidMoneyError(
        amount,
        `mais de ${DECIMAL_PLACES} casas decimais`,
      );
    }

    let decimal: Decimal;
    try {
      decimal = new Decimal(trimmed);
    } catch {
      throw new InvalidMoneyError(amount, "não é um número decimal válido");
    }

    if (!decimal.isFinite() || decimal.isNaN()) {
      throw new InvalidMoneyError(amount, "NaN ou Infinity não são permitidos");
    }

    if (decimal.isNegative()) {
      throw new InvalidMoneyError(
        amount,
        "valor negativo não permitido na entrada",
      );
    }

    const normalized = decimal.toFixed(DECIMAL_PLACES);

    return new Money(new Decimal(normalized), currency);
  }

  static zero(currency: Currency): Money {
    return new Money(new Decimal(0), currency);
  }

  static rehydrate(amount: string, currency: Currency): Money {
    return new Money(new Decimal(amount), currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.isPositive();
  }

  isNegative(): boolean {
    return this.value.isNegative();
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lt(other.value);
  }

  equals(other: Money): boolean {
    if (this.currency !== other.currency) return false;
    return this.value.eq(other.value);
  }

  toJSON(): MoneyProps {
    return {
      amount: this.value.toFixed(DECIMAL_PLACES),
      currency: this.currency,
    };
  }

  toString(): string {
    return `${this.value.toFixed(DECIMAL_PLACES)} ${this.currency}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new DifferentCurrencyError(this.currency, other.currency);
    }
  }
}
