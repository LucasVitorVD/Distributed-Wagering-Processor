import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { MetricsService } from '../common/metrics/metrics.module.js';
import {
  StructuredLogger,
  type StructuredLogFields,
} from '../common/observability/structured-logger.js';
import { WalletLedgerEntry } from '../domain/ledger/wallet-ledger-entry.entity.js';
import type {
  WagerTransactionRepository,
  WageringUnitOfWork,
} from '../domain/repositories/wagering-repositories.js';
import {
  DuplicateWagerTransactionError,
  IdempotencyConflictError,
  NegativeBalanceError,
  WalletNotFoundError,
  WagerTransactionNotFoundError,
} from '../domain/shared/errors.js';
import { Currency, Money } from '../domain/shared/money.js';
import { Wallet } from '../domain/wallet/wallet.entity.js';
import {
  FailureCode,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../domain/wagering/wager-transaction.entity.js';
import { WAGERING_UNIT_OF_WORK } from '../infrastructure/persistence/wagering-persistence.module.js';
import type { CreateWagerTransactionDto } from './dto/wager-transaction.dto.js';

const IDEMPOTENCY_KEY_MAX_LENGTH = 512;

interface WageringTransactionLogger {
  info(message: string, fields?: StructuredLogFields): void;
  warnEvent(message: string, fields?: StructuredLogFields): void;
}

interface CanonicalTransactionPayload {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  amount: {
    amount: string;
    currency: Currency;
  };
  referenceExternalTransactionId?: string;
}

export interface WagerTransactionResponse {
  id: string;
  walletId: string;
  providerId: string | null;
  externalTransactionId: string | null;
  playerId: string | null;
  roundId: string | null;
  gameId: string | null;
  kind: WagerTransactionKind;
  amount: {
    amount: string;
    currency: Currency;
  };
  status: WagerTransactionStatus;
  referenceExternalTransactionId: string | null;
  referenceTransactionId: string | null;
  failureCode: FailureCode | null;
  createdAt: string;
  processedAt: string | null;
}

export interface WagerTransactionWriteResponse {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: {
    amount: string;
    currency: Currency;
  };
  idempotentReplay: boolean;
}

@Injectable()
export class WageringTransactionsService {
  constructor(
    @Inject(WAGERING_UNIT_OF_WORK)
    private readonly unitOfWork: WageringUnitOfWork,
    private readonly metricsService: MetricsService,
    @Inject(StructuredLogger)
    private readonly logger: WageringTransactionLogger,
  ) {}

  async findById(id: string): Promise<WagerTransactionResponse> {
    return this.unitOfWork.transaction(async ({ wagerTransactions }) => {
      const transaction = await wagerTransactions.findById(id);

      if (!transaction) {
        throw new WagerTransactionNotFoundError();
      }

      return this.toResponse(transaction);
    });
  }

  async findByProviderIdentity(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransactionResponse> {
    return this.unitOfWork.transaction(async ({ wagerTransactions }) => {
      const transaction =
        await wagerTransactions.findByProviderAndExternalTransactionId(
          providerId,
          externalTransactionId,
        );

      if (!transaction) {
        throw new WagerTransactionNotFoundError();
      }

      return this.toResponse(transaction);
    });
  }

  async create(
    idempotencyKey: string | undefined,
    request: CreateWagerTransactionDto,
  ): Promise<WagerTransactionWriteResponse> {
    this.validateIdempotencyKey(idempotencyKey);
    const key = idempotencyKey;
    const money = Money.from(request.money);
    const payload = this.toCanonicalPayload(request, money);
    const payloadHash = createHash('sha256')
      .update(this.canonicalJson(payload), 'utf8')
      .digest('hex');
    const startedAt = performance.now();
    let walletId: string | null = null;

    try {
      let response: WagerTransactionWriteResponse;
      try {
        response = await this.unitOfWork.transaction(async (repositories) => {
          const existingByKey =
            await repositories.wagerTransactions.findByIdempotencyKey(key);

          if (existingByKey) {
            if (!existingByKey.matchesPayload(payloadHash)) {
              throw new IdempotencyConflictError();
            }

            walletId = existingByKey.wallet.id;
            return this.toWriteResponse(existingByKey, true);
          }

          const existingByProvider =
            await repositories.wagerTransactions.findByProviderAndExternalTransactionId(
              request.providerId,
              request.externalTransactionId,
            );
          if (existingByProvider) {
            throw new DuplicateWagerTransactionError();
          }

          const wallet =
            await repositories.wallets.findByIdForUpdate(request.walletId);
          if (!wallet) {
            throw new WalletNotFoundError();
          }
          if (wallet.playerId !== request.playerId) {
            throw new WalletNotFoundError();
          }
          walletId = wallet.id;

          const createdAt = new Date();
          const transaction = WagerTransaction.create({
            id: randomUUID(),
            wallet,
            providerId: request.providerId,
            externalTransactionId: request.externalTransactionId,
            playerId: request.playerId,
            roundId: request.roundId,
            gameId: request.gameId,
            kind: request.kind,
            amount: money,
            idempotencyKey: key,
            payloadHash,
            referenceExternalTransactionId:
              request.referenceExternalTransactionId,
            createdAt,
          });

          const result = await this.applyTransaction(
            repositories.wagerTransactions,
            wallet,
            transaction,
            createdAt,
          );
          transaction.recordResultingBalance(wallet.balance);

          repositories.wagerTransactions.save(transaction);
          repositories.wallets.save(wallet);

          if (result.ledgerEntry) {
            repositories.ledgerEntries.add(result.ledgerEntry);
          }

          return this.toWriteResponse(transaction, false);
        });
      } catch (error) {
        if (!(error instanceof UniqueConstraintViolationException)) {
          throw error;
        }

        response = await this.resolveUniqueConstraintRace(
          key,
          payloadHash,
          request.providerId,
          request.externalTransactionId,
        );
      }

      if (response.idempotentReplay) {
        this.metricsService.recordTransactionRetry();
      } else {
        this.metricsService.recordTransactionStatus(response.status);
      }
      this.logger.info('Wagering transaction request completed.', {
        transactionId: response.transactionId,
        walletId,
        providerId: request.providerId,
      });
      return response;
    } catch (error) {
      if (error instanceof DuplicateWagerTransactionError) {
        this.metricsService.recordDuplicateTransaction();
        this.logger.warnEvent('Duplicate wagering transaction detected.', {
          providerId: request.providerId,
          walletId,
          code: error.code,
        });
      } else if (error instanceof IdempotencyConflictError) {
        this.metricsService.recordIdempotencyConflict();
        this.logger.warnEvent('Wagering idempotency conflict detected.', {
          providerId: request.providerId,
          walletId,
          code: error.code,
        });
      }
      throw error;
    } finally {
      this.metricsService.observeTransactionProcessingDuration(
        (performance.now() - startedAt) / 1000,
      );
    }
  }

  private async applyTransaction(
    transactions: WagerTransactionRepository,
    wallet: Wallet,
    transaction: WagerTransaction,
    at: Date,
  ): Promise<{ ledgerEntry?: WalletLedgerEntry }> {
    let reference: WagerTransaction | undefined;

    if (
      transaction.kind === WagerTransactionKind.Refund ||
      transaction.kind === WagerTransactionKind.Rollback
    ) {
      reference = await this.findUsableReference(
        transactions,
        wallet,
        transaction,
      );

      if (!reference) {
        transaction.reject(FailureCode.INVALID_REFERENCE);
        return {};
      }
    }

    if (
      transaction.kind === WagerTransactionKind.Refund &&
      reference &&
      !(await this.canRefund(transactions, reference, transaction.amount))
    ) {
      transaction.reject(FailureCode.INVALID_REFERENCE);
      return {};
    }

    if (
      transaction.kind === WagerTransactionKind.Rollback &&
      reference &&
      !(await this.canRollback(transactions, reference))
    ) {
      transaction.reject(FailureCode.INVALID_REFERENCE);
      return {};
    }

    const direction = transaction.ledgerDirectionFor(reference);
    const balanceBefore = wallet.balance;

    if (direction === 'DEBIT') {
      try {
        wallet.debit(transaction.amount);
      } catch (error) {
        if (error instanceof NegativeBalanceError) {
          transaction.reject(FailureCode.INSUFFICIENT_BALANCE);
          return {};
        }
        throw error;
      }
    } else if (direction === 'CREDIT') {
      wallet.credit(transaction.amount);
    }

    transaction.markProcessed(reference?.id, at);

    if (!direction) {
      return {};
    }

    return {
      ledgerEntry: WalletLedgerEntry.create({
        id: randomUUID(),
        wallet,
        transaction,
        type: transaction.kind,
        direction,
        money: transaction.amount,
        balanceBefore,
        balanceAfter: wallet.balance,
        createdAt: at,
      }),
    };
  }

  private async findUsableReference(
    transactions: WagerTransactionRepository,
    wallet: Wallet,
    transaction: WagerTransaction,
  ): Promise<WagerTransaction | undefined> {
    const externalId = transaction.referenceExternalTransactionId;
    if (!externalId || !transaction.providerId) {
      return undefined;
    }

    const reference = await transactions.findByProviderAndExternalTransactionId(
      transaction.providerId,
      externalId,
    );
    if (
      !reference ||
      reference.status !== WagerTransactionStatus.Processed ||
      reference.wallet.id !== wallet.id ||
      reference.playerId !== transaction.playerId ||
      (transaction.kind === WagerTransactionKind.Refund
        ? reference.kind !== WagerTransactionKind.Bet
        : ![
            WagerTransactionKind.Bet,
            WagerTransactionKind.Win,
            WagerTransactionKind.Refund,
          ].includes(reference.kind)) ||
      (transaction.kind === WagerTransactionKind.Rollback &&
        !reference.amount.equals(transaction.amount))
    ) {
      return undefined;
    }

    return reference;
  }

  private async canRefund(
    transactions: WagerTransactionRepository,
    bet: WagerTransaction,
    refundAmount: Money,
  ): Promise<boolean> {
    const related = await this.findRelated(
      transactions,
      bet.providerId,
      bet.externalTransactionId,
    );
    const processedRollbacks = related.filter(
      (candidate) =>
        candidate.kind === WagerTransactionKind.Rollback &&
        candidate.status === WagerTransactionStatus.Processed &&
        candidate.referenceExternalTransactionId === bet.externalTransactionId,
    );
    if (processedRollbacks.length > 0) {
      return false;
    }

    const refundedAmount = Money.from({
      amount: '0',
      currency: bet.amount.currency,
    });
    let netRefunded = refundedAmount;

    for (const candidate of related) {
      if (
        candidate.status !== WagerTransactionStatus.Processed ||
        candidate.kind !== WagerTransactionKind.Refund
      ) {
        continue;
      }

      const refundRollbacks = await this.findRelated(
        transactions,
        candidate.providerId,
        candidate.externalTransactionId,
      );
      const wasRolledBack = refundRollbacks.some(
        (relatedTransaction) =>
          relatedTransaction.kind === WagerTransactionKind.Rollback &&
          relatedTransaction.status === WagerTransactionStatus.Processed &&
          relatedTransaction.referenceExternalTransactionId ===
            candidate.externalTransactionId,
      );

      netRefunded = wasRolledBack
        ? netRefunded
        : netRefunded.add(candidate.amount);
    }

    return !bet.amount.isLessThan(netRefunded.add(refundAmount));
  }

  private async canRollback(
    transactions: WagerTransactionRepository,
    reference: WagerTransaction,
  ): Promise<boolean> {
    const related = await this.findRelated(
      transactions,
      reference.providerId,
      reference.externalTransactionId,
    );
    const alreadyRolledBack = related.some(
      (candidate) =>
        candidate.kind === WagerTransactionKind.Rollback &&
        candidate.status === WagerTransactionStatus.Processed &&
        candidate.referenceExternalTransactionId ===
          reference.externalTransactionId,
    );
    if (alreadyRolledBack) {
      return false;
    }

    if (reference.kind !== WagerTransactionKind.Bet) {
      return true;
    }

    const hasNetRefund = await this.hasNetRefund(transactions, related);
    return !hasNetRefund;
  }

  private async hasNetRefund(
    transactions: WagerTransactionRepository,
    related: readonly WagerTransaction[],
  ): Promise<boolean> {
    let netRefunded = Money.zero('BRL');

    for (const candidate of related) {
      if (
        candidate.kind !== WagerTransactionKind.Refund ||
        candidate.status !== WagerTransactionStatus.Processed
      ) {
        continue;
      }

      const rollbackRows = await this.findRelated(
        transactions,
        candidate.providerId,
        candidate.externalTransactionId,
      );
      const wasRolledBack = rollbackRows.some(
        (row) =>
          row.kind === WagerTransactionKind.Rollback &&
          row.status === WagerTransactionStatus.Processed &&
          row.referenceExternalTransactionId ===
            candidate.externalTransactionId,
      );
      if (!wasRolledBack) {
        netRefunded = netRefunded.add(candidate.amount);
      }
    }

    return netRefunded.isPositive();
  }

  private findRelated(
    transactions: WagerTransactionRepository,
    providerId: string | undefined,
    externalTransactionId: string | undefined,
  ): Promise<readonly WagerTransaction[]> {
    if (!providerId || !externalTransactionId) {
      return Promise.resolve([]);
    }
    return transactions.findByProviderAndReferenceExternalTransactionId(
      providerId,
      externalTransactionId,
    );
  }

  private async resolveUniqueConstraintRace(
    idempotencyKey: string,
    payloadHash: string,
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransactionWriteResponse> {
    return this.unitOfWork.transaction(async ({ wagerTransactions }) => {
      const byKey =
        await wagerTransactions.findByIdempotencyKey(idempotencyKey);
      if (byKey) {
        if (!byKey.matchesPayload(payloadHash)) {
          throw new IdempotencyConflictError();
        }

        return this.toWriteResponse(byKey, true);
      }

      const byProvider =
        await wagerTransactions.findByProviderAndExternalTransactionId(
          providerId,
          externalTransactionId,
        );
      if (byProvider) {
        throw new DuplicateWagerTransactionError();
      }

      throw new Error('Unique constraint failed without a matching record.');
    });
  }

  private validateIdempotencyKey(
    idempotencyKey: string | undefined,
  ): asserts idempotencyKey is string {
    if (
      typeof idempotencyKey !== 'string' ||
      idempotencyKey.trim().length === 0 ||
      idempotencyKey.length > IDEMPOTENCY_KEY_MAX_LENGTH
    ) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message:
          'O header Idempotency-Key é obrigatório e deve ter até 512 caracteres.',
      });
    }
  }

  private toCanonicalPayload(
    request: CreateWagerTransactionDto,
    money: Money,
  ): CanonicalTransactionPayload {
    return {
      providerId: request.providerId,
      externalTransactionId: request.externalTransactionId,
      playerId: request.playerId,
      roundId: request.roundId,
      gameId: request.gameId,
      kind: request.kind,
      amount: money.toJSON(),
      ...(request.referenceExternalTransactionId
        ? {
            referenceExternalTransactionId:
              request.referenceExternalTransactionId,
          }
        : {}),
    };
  }

  private canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`;
    }
    if (typeof value === 'object' && value !== null) {
      const sortedEntries = Object.entries(value).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      );
      return `{${sortedEntries
        .map(
          ([key, item]) => `${JSON.stringify(key)}:${this.canonicalJson(item)}`,
        )
        .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
  }

  private toResponse(transaction: WagerTransaction): WagerTransactionResponse {
    return {
      id: transaction.id,
      walletId: transaction.wallet.id,
      providerId: transaction.providerId ?? null,
      externalTransactionId: transaction.externalTransactionId ?? null,
      playerId: transaction.playerId ?? null,
      roundId: transaction.roundId ?? null,
      gameId: transaction.gameId ?? null,
      kind: transaction.kind,
      amount: transaction.amount.toJSON(),
      status: transaction.status,
      referenceExternalTransactionId:
        transaction.referenceExternalTransactionId ?? null,
      referenceTransactionId: transaction.referenceTransactionId ?? null,
      failureCode: transaction.failureCode ?? null,
      createdAt: transaction.createdAt.toISOString(),
      processedAt: transaction.processedAt?.toISOString() ?? null,
    };
  }

  private toWriteResponse(
    transaction: WagerTransaction,
    idempotentReplay: boolean,
  ): WagerTransactionWriteResponse {
    return {
      transactionId: transaction.id,
      status: transaction.status,
      balance: transaction.resultingBalance.toJSON(),
      idempotentReplay,
    };
  }
}
