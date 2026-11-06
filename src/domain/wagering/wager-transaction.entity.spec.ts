import { describe, expect, it } from "vitest";
import { Money } from "../shared/money.js";
import { MissingTransactionReferenceError } from "../shared/errors.js";
import { Wallet } from "../wallet/wallet.entity.js";
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "./wager-transaction.entity.js";

describe("WagerTransaction", () => {
  const wallet = Wallet.open({
    id: "wallet-1",
    playerId: "player-1",
    initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
  });

  const createProps = (
    overrides: Partial<Parameters<typeof WagerTransaction.create>[0]> = {},
  ) => ({
    id: "transaction-1",
    wallet,
    providerId: "provider-1",
    externalTransactionId: "external-transaction-1",
    playerId: "player-1",
    roundId: "round-1",
    gameId: "game-1",
    kind: WagerTransactionKind.Bet,
    amount: Money.from({ amount: "25.00", currency: "BRL" }),
    idempotencyKey: "idempotency-1",
    payloadHash: "payload-hash-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  });

  describe("create", () => {
    it("cria transação em PENDING", () => {
      const transaction = WagerTransaction.create(createProps());

      expect(transaction.status).toBe(WagerTransactionStatus.Pending);
      expect(transaction.wallet).toBe(wallet);
      expect(transaction.providerId).toBe("provider-1");
      expect(transaction.externalTransactionId).toBe("external-transaction-1");
      expect(transaction.playerId).toBe("player-1");
      expect(transaction.roundId).toBe("round-1");
      expect(transaction.gameId).toBe("game-1");
      expect(transaction.amount.toJSON()).toEqual({
        amount: "25.00",
        currency: "BRL",
      });
    });

    it.each([
      WagerTransactionKind.Refund,
      WagerTransactionKind.Rollback,
    ])("exige referência externa para %s", (kind) => {
      expect(() =>
        WagerTransaction.create(createProps({ kind })),
      ).toThrow(MissingTransactionReferenceError);
    });

    it.each([
      WagerTransactionKind.Refund,
      WagerTransactionKind.Rollback,
    ])("aceita referência externa para %s", (kind) => {
      const transaction = WagerTransaction.create(
        createProps({
          kind,
          referenceExternalTransactionId: "external-reference-1",
        }),
      );

      expect(transaction.referenceExternalTransactionId).toBe(
        "external-reference-1",
      );
      expect(transaction.referenceTransactionId).toBeUndefined();
    });

    it("rejeita criação externa de OPENING", () => {
      expect(() =>
        WagerTransaction.create(
          createProps({ kind: WagerTransactionKind.Opening }),
        ),
      ).toThrow("OPENING transactions can only be created internally");
    });
  });

  describe("markPendingReference", () => {
    it("trata a repetição da transição como uma operação idempotente", () => {
      const transaction = WagerTransaction.create(createProps());

      transaction.markPendingReference();
      transaction.markPendingReference();

      expect(transaction.status).toBe(WagerTransactionStatus.PendingReference);
    });
  });

  describe("consultas", () => {
    it("identifica se está em estado terminal", () => {
      const transaction = WagerTransaction.create(createProps());

      expect(transaction.isTerminal()).toBe(false);

      transaction.markProcessed(undefined, new Date());

      expect(transaction.isTerminal()).toBe(true);
    });

    it.each([
      [WagerTransactionKind.Bet, true],
      [WagerTransactionKind.Win, true],
      [WagerTransactionKind.Loss, false],
      [WagerTransactionKind.Refund, true],
      [WagerTransactionKind.Rollback, true],
    ])("determina se %s afeta o saldo", (kind, affectsBalance) => {
      const transaction = WagerTransaction.create(
        createProps({
          kind,
          ...(kind === WagerTransactionKind.Refund ||
          kind === WagerTransactionKind.Rollback
            ? { referenceExternalTransactionId: "external-reference-1" }
            : {}),
        }),
      );

      expect(transaction.affectsBalance()).toBe(affectsBalance);
    });

    it.each([
      [WagerTransactionKind.Bet, false],
      [WagerTransactionKind.Win, false],
      [WagerTransactionKind.Loss, false],
      [WagerTransactionKind.Refund, true],
      [WagerTransactionKind.Rollback, true],
    ])("determina se %s exige referência", (kind, requiresReference) => {
      const transaction = WagerTransaction.create(
        createProps({
          kind,
          ...(requiresReference
            ? { referenceExternalTransactionId: "external-reference-1" }
            : {}),
        }),
      );

      expect(transaction.requiresReference()).toBe(requiresReference);
    });

    it("compara o hash do payload", () => {
      const transaction = WagerTransaction.create(createProps());

      expect(transaction.matchesPayload("payload-hash-1")).toBe(true);
      expect(transaction.matchesPayload("different-hash")).toBe(false);
    });

    it.each([
      [WagerTransactionKind.Bet, "DEBIT"],
      [WagerTransactionKind.Win, "CREDIT"],
      [WagerTransactionKind.Refund, "CREDIT"],
    ] as const)("determina direção %s", (kind, direction) => {
      const transaction = WagerTransaction.create(
        createProps({
          kind,
          ...(kind === WagerTransactionKind.Refund
            ? { referenceExternalTransactionId: "external-reference-1" }
            : {}),
        }),
      );

      expect(transaction.ledgerDirectionFor()).toBe(direction);
    });

    it("não atribui direção de ledger para LOSS", () => {
      const transaction = WagerTransaction.create(
        createProps({ kind: WagerTransactionKind.Loss }),
      );

      expect(transaction.ledgerDirectionFor()).toBeUndefined();
    });

    it.each([
      [WagerTransactionKind.Bet, "CREDIT"],
      [WagerTransactionKind.Win, "DEBIT"],
      [WagerTransactionKind.Refund, "DEBIT"],
    ] as const)("inverte a direção de %s para ROLLBACK", (referenceKind, direction) => {
      const reference = WagerTransaction.create(
        createProps({
          id: `reference-${referenceKind}`,
          kind: referenceKind,
          ...(referenceKind === WagerTransactionKind.Refund
            ? { referenceExternalTransactionId: "external-reference-1" }
            : {}),
        }),
      );
      const rollback = WagerTransaction.create(
        createProps({
          kind: WagerTransactionKind.Rollback,
          referenceExternalTransactionId: "external-reference-1",
        }),
      );

      expect(rollback.ledgerDirectionFor(reference)).toBe(direction);
    });

    it("rejeita ROLLBACK sem transação de referência", () => {
      const rollback = WagerTransaction.create(
        createProps({
          kind: WagerTransactionKind.Rollback,
          referenceExternalTransactionId: "external-reference-1",
        }),
      );

      expect(() => rollback.ledgerDirectionFor()).toThrow(
        "ROLLBACK requires a reference transaction",
      );
    });

    it("rejeita ROLLBACK referenciando LOSS", () => {
      const loss = WagerTransaction.create(
        createProps({ kind: WagerTransactionKind.Loss }),
      );
      const rollback = WagerTransaction.create(
        createProps({
          kind: WagerTransactionKind.Rollback,
          referenceExternalTransactionId: "external-reference-1",
        }),
      );

      expect(() => rollback.ledgerDirectionFor(loss)).toThrow(
        "Invalid transaction type for ROLLBACK",
      );
    });
  });

  describe("transições", () => {
    it("marca a transação como processada e guarda os dados do processamento", () => {
      const transaction = WagerTransaction.create(createProps());
      const processedAt = new Date("2026-01-01T00:02:00.000Z");

      transaction.markProcessed("transaction-0", processedAt);

      expect(transaction.status).toBe(WagerTransactionStatus.Processed);
      expect(transaction.referenceTransactionId).toBe("transaction-0");
      expect(transaction.processedAt).toBe(processedAt);
      expect(transaction.isTerminal()).toBe(true);
    });
  });

  describe("rehydrate", () => {
    it("restaura dados persistidos e o estado atual", () => {
      const createdAt = new Date("2026-01-01T00:00:00.000Z");
      const updatedAt = new Date("2026-01-01T00:01:00.000Z");
      const processedAt = new Date("2026-01-01T00:02:00.000Z");
      const transaction = WagerTransaction.rehydrate({
        id: "transaction-1",
        wallet,
        providerId: "provider-1",
        externalTransactionId: "external-transaction-1",
        playerId: "player-1",
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Refund,
        amountAmount: "25.00",
        amountCurrency: "BRL",
        status: WagerTransactionStatus.Processed,
        idempotencyKey: "idempotency-1",
        payloadHash: "payload-hash-1",
        referenceExternalTransactionId: "external-reference-1",
        referenceTransactionId: "transaction-0",
        createdAt,
        updatedAt,
        processedAt,
        failureCode: null,
      });

      expect(transaction.status).toBe(WagerTransactionStatus.Processed);
      expect(transaction.providerId).toBe("provider-1");
      expect(transaction.externalTransactionId).toBe("external-transaction-1");
      expect(transaction.playerId).toBe("player-1");
      expect(transaction.roundId).toBe("round-1");
      expect(transaction.gameId).toBe("game-1");
      expect(transaction.referenceExternalTransactionId).toBe(
        "external-reference-1",
      );
      expect(transaction.referenceTransactionId).toBe("transaction-0");
      expect(transaction.processedAt).toBe(processedAt);
      expect(transaction.amount.toJSON()).toEqual({
        amount: "25.00",
        currency: "BRL",
      });
    });
  });
});
