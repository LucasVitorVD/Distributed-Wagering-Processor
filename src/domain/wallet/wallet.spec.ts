import { describe, it, expect, beforeEach } from "vitest";
import { Wallet } from "./wallet.entity.js";
import { Money } from "../shared/money.js";

describe("Wallet", () => {
  let wallet: Wallet;

  beforeEach(() => {
    wallet = Wallet.open({
      id: "wallet-1",
      playerId: "player-1",
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    });
  });

  describe("open", () => {
    it("deve criar carteira com saldo inicial", () => {
      expect(wallet.id).toBe("wallet-1");
      expect(wallet.playerId).toBe("player-1");
      expect(wallet.balance.toJSON().amount).toBe("100.00");
    });

    it("deve rejeitar saldo inicial negativo", () => {
      expect(() =>
        Wallet.open({
          id: "wallet-2",
          playerId: "player-2",
          initialBalance: Money.from({ amount: "-10.00", currency: "BRL" }),
        }),
      ).toThrow();
    });
  });

  describe("credit", () => {
    it("deve aumentar o saldo e retornar o novo balance", () => {
      const result = wallet.credit(Money.from({ amount: "50.00", currency: "BRL" }));

      expect(result.toJSON().amount).toBe("150.00");
      expect(wallet.balance.toJSON().amount).toBe("150.00");
    });

    it("deve rejeitar moeda diferente", () => {
      expect(() =>
        wallet.credit(Money.from({ amount: "50.00", currency: "USD" })),
      ).toThrow();
    });
  });

  describe("debit", () => {
    it("deve diminuir o saldo e retornar o novo balance", () => {
      const result = wallet.debit(Money.from({ amount: "30.00", currency: "BRL" }));

      expect(result.toJSON().amount).toBe("70.00");
      expect(wallet.balance.toJSON().amount).toBe("70.00");
    });

    it("deve rejeitar saldo insuficiente", () => {
      expect(() =>
        wallet.debit(Money.from({ amount: "200.00", currency: "BRL" })),
      ).toThrow();
    });

    it("deve rejeitar moeda diferente", () => {
      expect(() =>
        wallet.debit(Money.from({ amount: "30.00", currency: "USD" })),
      ).toThrow();
    });
  });

  describe("saldo nunca negativo", () => {
    it("deve manter saldo inalterado quando débito falha por insuficiência", () => {
      const before = wallet.balance.toJSON().amount;
      expect(() =>
        wallet.debit(Money.from({ amount: "200.00", currency: "BRL" })),
      ).toThrow();
      expect(wallet.balance.toJSON().amount).toBe(before);
    });
  });
});
