import { describe, it, expect } from "vitest";
import { Money, type MoneyProps } from "./money.js";
import { InvalidMoneyError, DifferentCurrencyError } from "./money.js";

function props(amount: string, currency: "BRL" | "USD" | "EUR" = "BRL"): MoneyProps {
  return { amount, currency };
}

describe("Money.from (validação de entrada)", () => {
  it("aceita valores inteiros e normaliza para 2 casas", () => {
    const m = Money.from(props("25"));
    expect(m.toJSON().amount).toBe("25.00");
    expect(m.toString()).toBe("25.00 BRL");
  });

  it("aceita valores com 1 ou 2 casas decimais", () => {
    expect(Money.from(props("10.5")).toJSON().amount).toBe("10.50");
    expect(Money.from(props("10.50")).toJSON().amount).toBe("10.50");
    expect(Money.from(props("0.01")).toJSON().amount).toBe("0.01");
  });

  it("aceita zero", () => {
    const m = Money.from(props("0.00"));
    expect(m.isZero()).toBe(true);
    expect(m.toJSON().amount).toBe("0.00");
  });

  it("rejeita string vazia", () => {
    expect(() => Money.from(props(""))).toThrow(InvalidMoneyError);
  });

  it("rejeita apenas espaços", () => {
    expect(() => Money.from(props("   "))).toThrow(InvalidMoneyError);
  });

  it("rejeita notação científica", () => {
    expect(() => Money.from(props("1e2"))).toThrow(InvalidMoneyError);
    expect(() => Money.from(props("2.5E-3"))).toThrow(InvalidMoneyError);
  });

  it("rejeita mais de 2 casas decimais", () => {
    expect(() => Money.from(props("10.123"))).toThrow(InvalidMoneyError);
    expect(() => Money.from(props("0.001"))).toThrow(InvalidMoneyError);
  });

  it("rejeita NaN e Infinity", () => {
    expect(() => Money.from(props("NaN"))).toThrow(InvalidMoneyError);
    expect(() => Money.from(props("Infinity"))).toThrow(InvalidMoneyError);
  });

  it("rejeita valores negativos em contratos de entrada", () => {
    expect(() => Money.from(props("-10.00"))).toThrow(InvalidMoneyError);
  });

  it("rejeita formatos malformados (10., .50, +10.00, 01.00)", () => {
    expect(() => Money.from(props("10."))).toThrow(InvalidMoneyError);
    expect(() => Money.from(props(".50"))).toThrow(InvalidMoneyError);
    expect(() => Money.from(props("+10.00"))).toThrow(InvalidMoneyError);
    expect(() => Money.from(props("01.00"))).toThrow(InvalidMoneyError);
  });

  it("rejeita moeda não suportada", () => {
    // @ts-ignore - testando moeda inválida propositalmente
    expect(() => Money.from({ amount: "10.00", currency: "BATATA" })).toThrow(
      InvalidMoneyError,
    );
  });

  it("rejeita entrada não string", () => {
    // @ts-ignore - testando entrada inválida propositalmente
    expect(() => Money.from({ amount: 25, currency: "BRL" })).toThrow(
      InvalidMoneyError,
    );
  });
});

describe("Money.zero", () => {
  it("cria dinheiro zerado em uma moeda suportada", () => {
    const m = Money.zero("USD");
    expect(m.isZero()).toBe(true);
    expect(m.currency).toBe("USD");
    expect(m.toJSON().amount).toBe("0.00");
  });
});

describe("Money.rehydrate (reconstrução da persistência)", () => {
  it("reconstroi valor positivo sem revalidar regras de negócio", () => {
    const m = Money.rehydrate("100.00", "BRL");
    expect(m.toJSON().amount).toBe("100.00");
    expect(m.currency).toBe("BRL");
  });

  it("permite valores negativos (estado já persistido ou intermediário)", () => {
    const m = Money.rehydrate("-10.00", "BRL");
    expect(m.toJSON().amount).toBe("-10.00");
    expect(m.isNegative()).toBe(true);
  });

  it("rejeita mais de 2 casas decimais na reidratação", () => {
    expect(() => Money.rehydrate("10.999", "BRL")).toThrow(InvalidMoneyError);
  });

  it("rejeita moeda não suportada na reidratação", () => {
    // @ts-ignore - testando moeda inválida propositalmente
    expect(() => Money.rehydrate("10.00", "BATATA")).toThrow(InvalidMoneyError);
  });

  it("rejeita NaN e Infinity na reidratação", () => {
    expect(() => Money.rehydrate("NaN", "BRL")).toThrow(InvalidMoneyError);
    expect(() => Money.rehydrate("Infinity", "BRL")).toThrow(InvalidMoneyError);
  });
});

describe("Money operacoes (imutabilidade)", () => {
  it("add soma e retorna nova instancia sem alterar a original", () => {
    const a = Money.from(props("25.00"));
    const b = Money.from(props("10.00"));
    const c = a.add(b);
    expect(c.toJSON().amount).toBe("35.00");
    expect(a.toJSON().amount).toBe("25.00");
  });

  it("subtract subtrai e retorna nova instancia sem alterar a original", () => {
    const a = Money.from(props("100.00"));
    const b = Money.from(props("30.00"));
    const c = a.subtract(b);
    expect(c.toJSON().amount).toBe("70.00");
    expect(a.toJSON().amount).toBe("100.00");
  });

  it("subtract pode produzir negativo (responsabilidade da Wallet impedir)", () => {
    const balance = Money.from(props("10.00"));
    const bet = Money.from(props("20.00"));
    const result = balance.subtract(bet);
    expect(result.toJSON().amount).toBe("-10.00");
    expect(result.isNegative()).toBe(true);
  });

  it("negate inverte o sinal", () => {
    const a = Money.from(props("25.00"));
    const n = a.negate();
    expect(n.toJSON().amount).toBe("-25.00");
    expect(n.isNegative()).toBe(true);
    expect(a.isNegative()).toBe(false);
  });

  it("operacoes entre moedas diferentes lancam DifferentCurrencyError", () => {
    const a = Money.from(props("10.00", "BRL"));
    const b = Money.from(props("10.00", "USD"));
    expect(() => a.add(b)).toThrow(DifferentCurrencyError);
    expect(() => a.subtract(b)).toThrow(DifferentCurrencyError);
    expect(() => a.isLessThan(b)).toThrow(DifferentCurrencyError);
    expect(() => a.isGreaterThanOrEqual(b)).toThrow(DifferentCurrencyError);
  });
});

describe("Money comparacoes", () => {
  it("isPositive / isNegative / isZero", () => {
    expect(Money.from(props("10.00")).isPositive()).toBe(true);
    expect(Money.from(props("0.00")).isZero()).toBe(true);
    expect(Money.rehydrate("-5.00", "BRL").isNegative()).toBe(true);
  });

  it("isLessThan", () => {
    expect(
      Money.from(props("10.00")).isLessThan(Money.from(props("20.00"))),
    ).toBe(true);
    expect(
      Money.from(props("20.00")).isLessThan(Money.from(props("10.00"))),
    ).toBe(false);
    expect(
      Money.from(props("10.00")).isLessThan(Money.from(props("10.00"))),
    ).toBe(false);
  });

  it("isGreaterThanOrEqual", () => {
    expect(
      Money.from(props("20.00")).isGreaterThanOrEqual(Money.from(props("10.00"))),
    ).toBe(true);
    expect(
      Money.from(props("10.00")).isGreaterThanOrEqual(Money.from(props("10.00"))),
    ).toBe(true);
    expect(
      Money.from(props("10.00")).isGreaterThanOrEqual(Money.from(props("20.00"))),
    ).toBe(false);
  });

  it("equals considera moeda e valor", () => {
    expect(
      Money.from(props("10.00", "BRL")).equals(Money.from(props("10.00", "BRL"))),
    ).toBe(true);
    expect(
      Money.from(props("10.00", "BRL")).equals(Money.from(props("10.00", "USD"))),
    ).toBe(false);
    expect(
      Money.from(props("10.00")).equals(Money.from(props("20.00"))),
    ).toBe(false);
  });
});

describe("Money serializacao", () => {
  it("toJSON retorna MoneyProps com amount e currency", () => {
    const m = Money.from(props("25.50", "BRL"));
    expect(m.toJSON()).toEqual({ amount: "25.50", currency: "BRL" });
  });

  it("toString retorna formato legível", () => {
    const m = Money.from(props("25.50", "BRL"));
    expect(m.toString()).toBe("25.50 BRL");
  });
});
