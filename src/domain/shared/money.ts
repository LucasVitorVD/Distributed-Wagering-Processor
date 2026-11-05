import { Decimal } from "decimal.js";

const DECIMAL_PLACES = 2;

// Entrada de negócio (from): não permite zeros à esquerda, não permite negativo
const MONEY_PATTERN_INPUT = /^(0|[1-9]\d*)(\.\d{1,2})?$/;

// Reidratação (rehydrate): permite sinal negativo opcional, não permite zeros à esquerda
const MONEY_PATTERN_REHYDRATE = /^-?(0|[1-9]\d*)(\.\d{1,2})?$/;

const SUPPORTED_CURRENCIES = ["BRL", "USD", "EUR"] as const;

export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export class InvalidMoneyError extends Error {
  public readonly code = "INVALID_MONEY";

  constructor(amount: unknown, reason: string) {
    const safeAmount = typeof amount === "string" ? amount : String(amount);
    super(`Valor monetário inválido ${safeAmount}: ${reason}`);
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

    if (!MONEY_PATTERN_INPUT.test(trimmed)) {
      throw new InvalidMoneyError(
        amount,
        "formato decimal inválido (aceita até 2 casas decimais, sem sinal negativo, sem zeros à esquerda)",
      );
    }

    const validatedCurrency = Money.validateCurrency(currency, amount);

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

    return new Money(new Decimal(normalized), validatedCurrency);
  }

  static zero(currency: Currency): Money {
    return new Money(new Decimal(0), currency);
  }

  /**
   * Rehidrata um Money já persistido. Valida integridade dos dados do banco,
   * mas permite valores negativos (ex.: saldo zerado após operações intermediárias).
   */
  static rehydrate(amount: string, currency: string): Money {
    if (typeof amount !== "string" || amount.trim() === "") {
      throw new InvalidMoneyError(amount, "string vazia ou não é uma string");
    }

    const trimmed = amount.trim();

    if (!MONEY_PATTERN_REHYDRATE.test(trimmed)) {
      throw new InvalidMoneyError(
        amount,
        "formato decimal inválido (aceita até 2 casas decimais, sinal negativo opcional)",
      );
    }

    const validatedCurrency = Money.validateCurrency(currency, amount);

    let decimal: Decimal;
    try {
      decimal = new Decimal(trimmed);
    } catch {
      throw new InvalidMoneyError(amount, "não é um número decimal válido");
    }

    if (!decimal.isFinite() || decimal.isNaN()) {
      throw new InvalidMoneyError(amount, "NaN ou Infinity não são permitidos");
    }

    const normalized = decimal.toFixed(DECIMAL_PLACES);

    return new Money(new Decimal(normalized), validatedCurrency);
  }

  private static validateCurrency(
    currency: string,
    amount: unknown,
  ): Currency {
    if (!SUPPORTED_CURRENCIES.includes(currency as Currency)) {
      throw new InvalidMoneyError(amount, `moeda não suportada: ${currency}`);
    }
    return currency as Currency;
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

  isGreaterThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.greaterThanOrEqualTo(other.value);
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
