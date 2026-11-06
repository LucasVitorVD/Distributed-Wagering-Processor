import { randomUUID } from 'node:crypto';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { MikroORM } from '@mikro-orm/postgresql';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import config from '../src/config/mikro-orm.config.js';
import { configureApplication } from '../src/common/configure-application.js';
import { HealthModule } from '../src/health/health.module.js';
import { SQS_READINESS_CLIENT } from '../src/health/health.tokens.js';
import { WalletLedgerEntry } from '../src/domain/ledger/wallet-ledger-entry.entity.js';
import { Wallet } from '../src/domain/wallet/wallet.entity.js';
import { WagerTransaction } from '../src/domain/wagering/wager-transaction.entity.js';
import { WalletsModule } from '../src/wallets/wallets.module.js';
import { WageringTransactionsModule } from '../src/wagering/wagering-transactions.module.js';

const databaseConfig = {
  ...config,
  dbName: process.env.POSTGRES_TEST_DB ?? 'wagering_test',
  user: process.env.POSTGRES_TEST_USER ?? 'wagering_test',
  password: process.env.POSTGRES_TEST_PASSWORD ?? 'wagering_test',
  host: process.env.POSTGRES_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.POSTGRES_TEST_PORT ?? 5434),
  entities: [Wallet, WagerTransaction, WalletLedgerEntry],
  entitiesTs: [],
  migrations: {
    ...config.migrations,
    path: './dist/migrations',
    pathTs: './dist/migrations',
  },
};

describe('wagering transaction API with PostgreSQL', () => {
  let app: INestApplication;
  let orm: MikroORM;

  beforeAll(async () => {
    const moduleBuilder = Test.createTestingModule({
      imports: [
        MikroOrmModule.forRoot(databaseConfig),
        WalletsModule,
        WageringTransactionsModule,
        HealthModule,
      ],
    })
      .overrideProvider(SQS_READINESS_CLIENT)
      .useValue({
        getQueueAttributes: async () => undefined,
        destroy: () => undefined,
      });
    const moduleRef: TestingModule = await moduleBuilder.compile();

    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    orm = app.get(MikroORM);
    await orm.getMigrator().up();
  });

  afterAll(async () => {
    await app?.close();
  });

  async function createWallet(amount = '0') {
    const playerId = randomUUID();
    const response = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId,
        initialBalance: { amount, currency: 'BRL' },
      });

    expect(response.status).toBe(201);
    return { playerId, walletId: response.body.id as string };
  }

  function transactionBody(
    playerId: string,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      providerId: 'provider-test',
      externalTransactionId: randomUUID(),
      playerId,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: 'BET',
      amount: { amount: '10', currency: 'BRL' },
      ...overrides,
    };
  }

  function postTransaction(body: Record<string, unknown>, key: string) {
    return request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', key)
      .send(body);
  }

  function idempotencyKey(label: string): string {
    return `${label}:${randomUUID()}`;
  }

  it('processes a bet once and returns the same public representation from both GETs', async () => {
    const { playerId, walletId } = await createWallet('25.00');
    const body = transactionBody(playerId);
    const key = `provider-test:${body.externalTransactionId}`;

    const created = await postTransaction(body, key);

    expect(created.status).toBe(200);
    expect(created.body).toEqual({
      transactionId: expect.any(String),
      status: 'PROCESSED',
      balance: { amount: '15.00', currency: 'BRL' },
      idempotentReplay: false,
    });

    const replay = await postTransaction(
      { ...body, amount: { amount: '10.00', currency: 'BRL' } },
      key,
    );
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({
      transactionId: created.body.transactionId,
      status: 'PROCESSED',
      balance: { amount: '15.00', currency: 'BRL' },
      idempotentReplay: true,
    });

    const byId = await request(app.getHttpServer()).get(
      `/wagering/transactions/${created.body.transactionId}`,
    );
    const byProvider = await request(app.getHttpServer()).get(
      `/providers/provider-test/wagering/transactions/${body.externalTransactionId}`,
    );
    expect(byId.status).toBe(200);
    expect(byProvider.status).toBe(200);
    expect(byId.body).toEqual(byProvider.body);
    expect(byId.body).not.toHaveProperty('idempotencyKey');
    expect(byId.body).not.toHaveProperty('payloadHash');

    const wallet = await request(app.getHttpServer()).get(
      `/wallets/${walletId}`,
    );
    expect(wallet.body.balance).toEqual({
      amount: '15.00',
      currency: 'BRL',
    });

    const ledger = await request(app.getHttpServer()).get(
      `/wallets/${walletId}/ledger`,
    );
    expect(ledger.body.items).toHaveLength(2);
    expect(ledger.body.items[0]).toMatchObject({
      type: 'BET',
      direction: 'DEBIT',
      amount: { amount: '10.00', currency: 'BRL' },
    });

    const laterBody = transactionBody(playerId, {
      amount: { amount: '2.00', currency: 'BRL' },
    });
    const later = await postTransaction(laterBody, idempotencyKey('later-bet'));
    expect(later.body.balance).toEqual({ amount: '13.00', currency: 'BRL' });

    const replayAfterBalanceChange = await postTransaction(body, key);
    expect(replayAfterBalanceChange.body).toEqual({
      transactionId: created.body.transactionId,
      status: 'PROCESSED',
      balance: { amount: '15.00', currency: 'BRL' },
      idempotentReplay: true,
    });
  });

  it('returns conflicts for a changed payload or duplicate provider identity', async () => {
    const { playerId } = await createWallet('50.00');
    const body = transactionBody(playerId);
    const key = idempotencyKey('first-key');
    const created = await postTransaction(body, key);
    expect(created.status).toBe(200);

    const changedPayload = await postTransaction(
      { ...body, roundId: 'another-round' },
      key,
    );
    expect(changedPayload.status).toBe(409);
    expect(changedPayload.body.code).toBe('IDEMPOTENCY_CONFLICT');

    const duplicateIdentity = await postTransaction(
      body,
      idempotencyKey('second-key'),
    );
    expect(duplicateIdentity.status).toBe(409);
    expect(duplicateIdentity.body.code).toBe('DUPLICATE_TRANSACTION');

    const metrics = await request(app.getHttpServer()).get('/metrics');
    expect(metrics.text).toMatch(
      /wagering_duplicate_transactions_total 1(?:\.0)?/,
    );
    expect(metrics.text).toMatch(
      /wagering_idempotency_conflicts_total 1(?:\.0)?/,
    );
    expect(metrics.text).toMatch(
      /wagering_transactions_total\{status="PROCESSED"\} [1-9]\d*(?:\.0)?/,
    );
    expect(metrics.text).toMatch(
      /wagering_transaction_retries_total [1-9]\d*(?:\.0)?/,
    );
    expect(metrics.text).toMatch(
      /wagering_transaction_processing_duration_seconds_count [1-9]\d*/,
    );
  });

  it('persists insufficient balance as a rejection without a ledger entry', async () => {
    const { playerId, walletId } = await createWallet();
    const body = transactionBody(playerId);
    const key = idempotencyKey('insufficient-balance-key');
    const response = await postTransaction(body, key);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      transactionId: expect.any(String),
      status: 'REJECTED',
      balance: { amount: '0.00', currency: 'BRL' },
      idempotentReplay: false,
    });

    const ledger = await request(app.getHttpServer()).get(
      `/wallets/${walletId}/ledger`,
    );
    expect(ledger.body.items).toHaveLength(0);

    const transaction = await request(app.getHttpServer()).get(
      `/wagering/transactions/${response.body.transactionId}`,
    );
    expect(transaction.body.failureCode).toBe('INSUFFICIENT_BALANCE');

    const replay = await postTransaction(body, key);
    expect(replay.body).toEqual({
      transactionId: response.body.transactionId,
      status: 'REJECTED',
      balance: { amount: '0.00', currency: 'BRL' },
      idempotentReplay: true,
    });
  });

  it('credits WIN transactions and records LOSS without changing the balance', async () => {
    const { playerId, walletId } = await createWallet('10.00');
    const winBody = transactionBody(playerId, {
      externalTransactionId: randomUUID(),
      kind: 'WIN',
      amount: { amount: '2.50', currency: 'BRL' },
    });
    const win = await postTransaction(winBody, idempotencyKey('win-key'));
    expect(win.body.status).toBe('PROCESSED');

    const rollbackWinBody = transactionBody(playerId, {
      externalTransactionId: randomUUID(),
      kind: 'ROLLBACK',
      amount: { amount: '2.50', currency: 'BRL' },
      referenceExternalTransactionId: winBody.externalTransactionId,
    });
    const rollbackWin = await postTransaction(
      rollbackWinBody,
      idempotencyKey('rollback-win-key'),
    );
    expect(rollbackWin.body.status).toBe('PROCESSED');

    const lossBody = transactionBody(playerId, {
      externalTransactionId: randomUUID(),
      kind: 'LOSS',
      amount: { amount: '4.00', currency: 'BRL' },
    });
    const loss = await postTransaction(lossBody, idempotencyKey('loss-key'));
    expect(loss.body.status).toBe('PROCESSED');

    const betBody = transactionBody(playerId, {
      externalTransactionId: randomUUID(),
      amount: { amount: '1.50', currency: 'BRL' },
    });
    const bet = await postTransaction(betBody, idempotencyKey('bet-key'));
    expect(bet.body.status).toBe('PROCESSED');

    const rollbackBetBody = transactionBody(playerId, {
      externalTransactionId: randomUUID(),
      kind: 'ROLLBACK',
      amount: { amount: '1.50', currency: 'BRL' },
      referenceExternalTransactionId: betBody.externalTransactionId,
    });
    const rollbackBet = await postTransaction(
      rollbackBetBody,
      idempotencyKey('rollback-bet-key'),
    );
    expect(rollbackBet.body.status).toBe('PROCESSED');

    const wallet = await request(app.getHttpServer()).get(
      `/wallets/${walletId}`,
    );
    expect(wallet.body.balance).toEqual({
      amount: '10.00',
      currency: 'BRL',
    });

    const ledger = await request(app.getHttpServer()).get(
      `/wallets/${walletId}/ledger`,
    );
    expect(ledger.body.items).toHaveLength(5);
    expect(ledger.body.items[0]).toMatchObject({
      type: 'ROLLBACK',
      direction: 'CREDIT',
    });
  });

  it('replays concurrent matching requests without applying effects twice', async () => {
    const { playerId, walletId } = await createWallet('10.00');
    const body = transactionBody(playerId, {
      amount: { amount: '2.00', currency: 'BRL' },
    });
    const key = idempotencyKey('concurrent-bet');

    const responses = await Promise.all([
      postTransaction(body, key),
      postTransaction(body, key),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(responses[0].body.transactionId).toBe(
      responses[1].body.transactionId,
    );
    expect(
      responses
        .map((response) => response.body.idempotentReplay)
        .sort((left, right) => Number(left) - Number(right)),
    ).toEqual([false, true]);

    const wallet = await request(app.getHttpServer()).get(
      `/wallets/${walletId}`,
    );
    expect(wallet.body.balance).toEqual({
      amount: '8.00',
      currency: 'BRL',
    });
  });

  it('conflicts when concurrent requests reuse a key with different payloads', async () => {
    const { playerId, walletId } = await createWallet('10.00');
    const firstBody = transactionBody(playerId, {
      amount: { amount: '2.00', currency: 'BRL' },
    });
    const secondBody = { ...firstBody, roundId: 'different-round' };
    const key = idempotencyKey('concurrent-conflict');

    const responses = await Promise.all([
      postTransaction(firstBody, key),
      postTransaction(secondBody, key),
    ]);

    expect(
      responses
        .map((response) => response.status)
        .sort((left, right) => left - right),
    ).toEqual([200, 409]);
    expect(
      responses.find((response) => response.status === 409)?.body.code,
    ).toBe('IDEMPOTENCY_CONFLICT');

    const wallet = await request(app.getHttpServer()).get(
      `/wallets/${walletId}`,
    );
    expect(wallet.body.balance).toEqual({
      amount: '8.00',
      currency: 'BRL',
    });
  });

  it('enforces refund limits and restores allowance when a refund is rolled back', async () => {
    const { playerId, walletId } = await createWallet('100.00');
    const betBody = transactionBody(playerId, {
      amount: { amount: '20.00', currency: 'BRL' },
    });
    const bet = await postTransaction(betBody, idempotencyKey('bet-key'));
    expect(bet.body.status).toBe('PROCESSED');

    const refundBody = transactionBody(playerId, {
      externalTransactionId: randomUUID(),
      kind: 'REFUND',
      amount: { amount: '5.00', currency: 'BRL' },
      referenceExternalTransactionId: betBody.externalTransactionId,
    });
    const refund = await postTransaction(
      refundBody,
      idempotencyKey('refund-key'),
    );
    expect(refund.body.status, JSON.stringify(refund.body)).toBe('PROCESSED');
    const refundLookup = await request(app.getHttpServer()).get(
      `/wagering/transactions/${refund.body.transactionId}`,
    );
    expect(refund.body.status).toBe('PROCESSED');
    expect(refundLookup.body.referenceTransactionId).toBe(
      bet.body.transactionId,
    );

    const excessiveRefund = transactionBody(playerId, {
      externalTransactionId: randomUUID(),
      kind: 'REFUND',
      amount: { amount: '16.00', currency: 'BRL' },
      referenceExternalTransactionId: betBody.externalTransactionId,
    });
    const rejectedRefund = await postTransaction(
      excessiveRefund,
      idempotencyKey('excessive-refund-key'),
    );
    expect(rejectedRefund.body.status).toBe('REJECTED');
    const rejectedRefundLookup = await request(app.getHttpServer()).get(
      `/wagering/transactions/${rejectedRefund.body.transactionId}`,
    );
    expect(rejectedRefundLookup.body.failureCode).toBe('INVALID_REFERENCE');

    const rollbackRefund = transactionBody(playerId, {
      externalTransactionId: randomUUID(),
      kind: 'ROLLBACK',
      amount: { amount: '5.00', currency: 'BRL' },
      referenceExternalTransactionId: refundBody.externalTransactionId,
    });
    const rollback = await postTransaction(
      rollbackRefund,
      idempotencyKey('rollback-refund-key'),
    );
    expect(rollback.body.status).toBe('PROCESSED');

    const remainingRefund = transactionBody(playerId, {
      externalTransactionId: randomUUID(),
      kind: 'REFUND',
      amount: { amount: '20.00', currency: 'BRL' },
      referenceExternalTransactionId: betBody.externalTransactionId,
    });
    const finalRefund = await postTransaction(
      remainingRefund,
      idempotencyKey('remaining-refund-key'),
    );
    expect(finalRefund.body.status).toBe('PROCESSED');

    const rollbackBet = transactionBody(playerId, {
      externalTransactionId: randomUUID(),
      kind: 'ROLLBACK',
      amount: { amount: '20.00', currency: 'BRL' },
      referenceExternalTransactionId: betBody.externalTransactionId,
    });
    const rejectedRollback = await postTransaction(
      rollbackBet,
      idempotencyKey('rollback-bet-key'),
    );
    expect(rejectedRollback.body.status).toBe('REJECTED');
    const rejectedRollbackLookup = await request(app.getHttpServer()).get(
      `/wagering/transactions/${rejectedRollback.body.transactionId}`,
    );
    expect(rejectedRollbackLookup.body.failureCode).toBe('INVALID_REFERENCE');

    const wallet = await request(app.getHttpServer()).get(
      `/wallets/${walletId}`,
    );
    expect(wallet.body.balance).toEqual({
      amount: '100.00',
      currency: 'BRL',
    });
  });

  it('validates keys, references, extra fields, and lookup IDs', async () => {
    const { playerId } = await createWallet('10.00');
    const body = transactionBody(playerId);

    const missingKey = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .send(body);
    expect(missingKey.status).toBe(400);
    expect(missingKey.body.code).toBe('VALIDATION_ERROR');

    const unexpectedField = await postTransaction(
      { ...body, extra: true },
      idempotencyKey('extra-field-key'),
    );
    expect(unexpectedField.status).toBe(400);
    expect(unexpectedField.body.code).toBe('VALIDATION_ERROR');

    const invalidReference = await postTransaction(
      {
        ...body,
        kind: 'REFUND',
        referenceExternalTransactionId: ' ',
      },
      idempotencyKey('invalid-reference-key'),
    );
    expect(invalidReference.status).toBe(400);
    expect(invalidReference.body.code).toBe('VALIDATION_ERROR');

    const malformedId = await request(app.getHttpServer()).get(
      '/wagering/transactions/not-a-uuid',
    );
    expect(malformedId.status).toBe(400);
    expect(malformedId.body.code).toBe('VALIDATION_ERROR');

    const missingTransaction = await request(app.getHttpServer()).get(
      `/providers/provider-test/wagering/transactions/${randomUUID()}`,
    );
    expect(missingTransaction.status).toBe(404);
    expect(missingTransaction.body.code).toBe('WAGER_TRANSACTION_NOT_FOUND');
  });

  it('does not reserve the key when the wallet does not exist', async () => {
    const playerId = randomUUID();
    const body = transactionBody(playerId);
    const key = idempotencyKey('missing-wallet-key');

    const notFound = await postTransaction(body, key);
    expect(notFound.status).toBe(404);
    expect(notFound.body.code).toBe('WALLET_NOT_FOUND');

    await createWalletForPlayer(playerId);
    const created = await postTransaction(body, key);
    expect(created.status).toBe(200);
    expect(created.body.status).toBe('REJECTED');
    expect(created.body.idempotentReplay).toBe(false);
  });

  async function createWalletForPlayer(playerId: string): Promise<void> {
    const response = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId,
        initialBalance: { amount: '0', currency: 'BRL' },
      });
    expect(response.status).toBe(201);
  }
});
