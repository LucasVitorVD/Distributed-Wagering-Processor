import { describe, it, expect } from "vitest";
import { WalletLedgerEntry } from "./wallet-ledger-entry.entity.js";
import { Money } from "../shared/money.js";
import { Wallet } from "../wallet/wallet.entity.js";
import {
  WagerTransaction,
  WagerTransactionKind,
} from "../wagering/wager-transaction.entity.js";
import {
  InvalidLedgerAmountError,
  LedgerCurrencyMismatchError,
  NegativeLedgerBalanceError,
  UnbalancedLedgerEntryError,
} from "../shared/errors.js";

describe("WalletLedgerEntry", () => {
  const walletId = "wallet-1";
  const transactionId = "tx-1";
  const wallet = Wallet.open({
    id: walletId,
    playerId: "player-1",
    initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
  });
  const transaction = WagerTransaction.create({
    id: transactionId,
    wallet,
    providerId: "provider-1",
    externalTransactionId: "external-transaction-1",
    playerId: "player-1",
    roundId: "round-1",
    gameId: "game-1",
    kind: WagerTransactionKind.Win,
    amount: Money.from({ amount: "25.00", currency: "BRL" }),
    idempotencyKey: "idempotency-1",
    payloadHash: "payload-hash-1",
    createdAt: new Date(),
  });

  describe("create", () => {
    it("aceita lançamento CREDIT balanceado", () => {
      const entry = WalletLedgerEntry.create({
        id: "entry-1",
        wallet,
        transaction,
        type: "WIN",
        direction: "CREDIT",
        money: Money.from({ amount: "25.00", currency: "BRL" }),
        balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
        balanceAfter: Money.from({ amount: "125.00", currency: "BRL" }),
        createdAt: new Date(),
      });

      expect(entry.direction).toBe("CREDIT");
      expect(entry.isBalanced()).toBe(true);
    });

    it("aceita lançamento DEBIT balanceado", () => {
      const entry = WalletLedgerEntry.create({
        id: "entry-2",
        wallet,
        transaction,
        type: "BET",
        direction: "DEBIT",
        money: Money.from({ amount: "30.00", currency: "BRL" }),
        balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
        balanceAfter: Money.from({ amount: "70.00", currency: "BRL" }),
        createdAt: new Date(),
      });

      expect(entry.direction).toBe("DEBIT");
      expect(entry.isBalanced()).toBe(true);
    });

    it("rejeita valor não positivo", () => {
      expect(() =>
        WalletLedgerEntry.create({
          id: "entry-3",
          wallet,
          transaction,
          type: "WIN",
          direction: "CREDIT",
          money: Money.from({ amount: "0.00", currency: "BRL" }),
          balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
          balanceAfter: Money.from({ amount: "100.00", currency: "BRL" }),
          createdAt: new Date(),
        }),
      ).toThrow(InvalidLedgerAmountError);
    });

    it("rejeita moeda diferente entre money e balanceBefore", () => {
      expect(() =>
        WalletLedgerEntry.create({
          id: "entry-4",
          wallet,
          transaction,
          type: "WIN",
          direction: "CREDIT",
          money: Money.from({ amount: "25.00", currency: "USD" }),
          balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
          balanceAfter: Money.from({ amount: "125.00", currency: "BRL" }),
          createdAt: new Date(),
        }),
      ).toThrow(LedgerCurrencyMismatchError);
    });

    it("rejeita saldo before negativo", () => {
      expect(() =>
        WalletLedgerEntry.create({
          id: "entry-5",
          wallet,
          transaction,
          type: "WIN",
          direction: "CREDIT",
          money: Money.from({ amount: "25.00", currency: "BRL" }),
          balanceBefore: Money.rehydrate("-10.00", "BRL"),
          balanceAfter: Money.from({ amount: "15.00", currency: "BRL" }),
          createdAt: new Date(),
        }),
      ).toThrow(NegativeLedgerBalanceError);
    });

    it("rejeita lançamento desbalanceado", () => {
      expect(() =>
        WalletLedgerEntry.create({
          id: "entry-6",
          wallet,
          transaction,
          type: "WIN",
          direction: "CREDIT",
          money: Money.from({ amount: "25.00", currency: "BRL" }),
          balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
          balanceAfter: Money.from({ amount: "110.00", currency: "BRL" }),
          createdAt: new Date(),
        }),
      ).toThrow(UnbalancedLedgerEntryError);
    });
  });

  describe("erros de domínio", () => {
    it("expõe nome e código específicos", () => {
      const error = new InvalidLedgerAmountError();

      expect(error.name).toBe("InvalidLedgerAmountError");
      expect(error.code).toBe("INVALID_LEDGER_AMOUNT");
    });
  });

  describe("isBalanced", () => {
    it("verifica aritmética exata para DEBIT", () => {
      const entry = WalletLedgerEntry.create({
        id: "entry-7",
        wallet,
        transaction,
        type: "BET",
        direction: "DEBIT",
        money: Money.from({ amount: "0.01", currency: "BRL" }),
        balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
        balanceAfter: Money.from({ amount: "99.99", currency: "BRL" }),
        createdAt: new Date(),
      });

      expect(entry.isBalanced()).toBe(true);
    });

    it("verifica aritmética exata para CREDIT", () => {
      const entry = WalletLedgerEntry.create({
        id: "entry-8",
        wallet,
        transaction,
        type: "WIN",
        direction: "CREDIT",
        money: Money.from({ amount: "0.01", currency: "BRL" }),
        balanceBefore: Money.from({ amount: "99.99", currency: "BRL" }),
        balanceAfter: Money.from({ amount: "100.00", currency: "BRL" }),
        createdAt: new Date(),
      });

      expect(entry.isBalanced()).toBe(true);
    });
  });

  describe("rehydrate", () => {
    it("reconstroi a partir da persistência", () => {
      const entry = WalletLedgerEntry.rehydrate({
        id: "entry-1",
        walletId,
        transactionId,
        type: "BET",
        direction: "DEBIT",
        moneyAmount: "25.00",
        moneyCurrency: "BRL",
        balanceBeforeAmount: "100.00",
        balanceBeforeCurrency: "BRL",
        balanceAfterAmount: "75.00",
        balanceAfterCurrency: "BRL",
        createdAt: new Date(),
      }, wallet, transaction);

      expect(entry.id).toBe("entry-1");
      expect(entry.wallet.id).toBe(walletId);
      expect(entry.transactionId).toBe(transactionId);
      expect(entry.transaction).toBe(transaction);
      expect(entry.money.toJSON().amount).toBe("25.00");
      expect(entry.balanceBefore.toJSON().amount).toBe("100.00");
      expect(entry.balanceAfter.toJSON().amount).toBe("75.00");
      expect(entry.isBalanced()).toBe(true);
    });
  });

  describe("imutabilidade", () => {
    it("não tem métodos de transição", () => {
      const entry = WalletLedgerEntry.create({
        id: "entry-9",
        wallet,
        transaction,
        type: "WIN",
        direction: "CREDIT",
        money: Money.from({ amount: "10.00", currency: "BRL" }),
        balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
        balanceAfter: Money.from({ amount: "110.00", currency: "BRL" }),
        createdAt: new Date(),
      });

      expect((entry as unknown as { markProcessed?: Function }).markProcessed).toBeUndefined();
      expect((entry as unknown as { reject?: Function }).reject).toBeUndefined();
      expect(entry.direction).toBe("CREDIT");
    });
  });
});
