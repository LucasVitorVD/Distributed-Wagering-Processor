import { Global, Injectable, Module } from '@nestjs/common';
import { Counter, Histogram, Registry } from '@prometheus-io/client';
import { StructuredLogger } from '../observability/structured-logger.js';

@Injectable()
export class MetricsService {
  private readonly registry = new Registry();
  private readonly transactionsByStatus = new Counter<'status'>({
    name: 'wagering_transactions_total',
    help: 'Number of new wagering transactions by terminal status.',
    labelNames: ['status'],
    registers: [this.registry],
  });
  private readonly duplicateTransactions = new Counter({
    name: 'wagering_duplicate_transactions_total',
    help: 'Number of duplicate provider transaction identities detected.',
    registers: [this.registry],
  });
  private readonly idempotencyConflicts = new Counter({
    name: 'wagering_idempotency_conflicts_total',
    help: 'Number of idempotency keys reused with a different payload.',
    registers: [this.registry],
  });
  private readonly transactionRetries = new Counter({
    name: 'wagering_transaction_retries_total',
    help: 'Number of idempotent transaction replays.',
    registers: [this.registry],
  });
  private readonly lockConflicts = new Counter({
    name: 'wagering_lock_conflicts_total',
    help: 'Number of database deadlocks, lock conflicts, or serialization failures.',
    registers: [this.registry],
  });
  private readonly transactionProcessingDuration = new Histogram({
    name: 'wagering_transaction_processing_duration_seconds',
    help: 'Time spent processing a wagering transaction request.',
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });
  private readonly reconciliationMismatches = new Counter({
    name: 'wallet_reconciliation_mismatches_total',
    help: 'Number of wallet reconciliations with a balance mismatch.',
    registers: [this.registry],
  });

  recordWalletReconciliationMismatch(): void {
    this.reconciliationMismatches.inc();
  }

  recordTransactionStatus(status: string): void {
    this.transactionsByStatus.inc({ status });
  }

  recordDuplicateTransaction(): void {
    this.duplicateTransactions.inc();
  }

  recordIdempotencyConflict(): void {
    this.idempotencyConflicts.inc();
  }

  recordTransactionRetry(): void {
    this.transactionRetries.inc();
  }

  recordLockConflict(): void {
    this.lockConflicts.inc();
  }

  observeTransactionProcessingDuration(durationSeconds: number): void {
    this.transactionProcessingDuration.observe(durationSeconds);
  }

  async getMetrics(): Promise<{ contentType: string; body: string }> {
    return {
      contentType: this.registry.contentType,
      body: await this.registry.metrics(),
    };
  }
}

@Global()
@Module({
  providers: [MetricsService, StructuredLogger],
  exports: [MetricsService, StructuredLogger],
})
export class MetricsModule {}
