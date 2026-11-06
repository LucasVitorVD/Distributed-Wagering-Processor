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
import { Money } from '../src/domain/shared/money.js';
import { Wallet } from '../src/domain/wallet/wallet.entity.js';
import {
  WagerTransaction,
  WagerTransactionKind,
} from '../src/domain/wagering/wager-transaction.entity.js';
import { WalletsModule } from '../src/wallets/wallets.module.js';

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

describe('wallet query API with PostgreSQL', () => {
  let app: INestApplication;
  let orm: MikroORM;

  beforeAll(async () => {
    const moduleBuilder = Test.createTestingModule({
      imports: [
        MikroOrmModule.forRoot(databaseConfig),
        WalletsModule,
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

  async function createWallet(initialAmount = '0') {
    const response = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId: randomUUID(),
        initialBalance: { amount: initialAmount, currency: 'BRL' },
      });

    expect(response.status).toBe(201);
    return response.body as { id: string; balance: { amount: string } };
  }

  async function addBetEntries(walletId: string, ids: string[]) {
    const em = orm.em.fork();
    const wallet = await em.findOneOrFail(Wallet, { id: walletId });
    const createdAt = new Date('2026-01-02T03:04:05.006Z');

    for (const id of ids) {
      const transactionId = randomUUID();
      const transaction = WagerTransaction.create({
        id: transactionId,
        wallet,
        providerId: `provider-${transactionId}`,
        externalTransactionId: `external-${transactionId}`,
        playerId: wallet.playerId,
        roundId: `round-${transactionId}`,
        gameId: `game-${transactionId}`,
        kind: WagerTransactionKind.Bet,
        amount: Money.from({ amount: '1.00', currency: 'BRL' }),
        idempotencyKey: `idempotency-${transactionId}`,
        payloadHash: `payload-${transactionId}`,
        createdAt,
      });
      transaction.recordResultingBalance(
        Money.from({ amount: '1.00', currency: 'BRL' }),
      );
      const entry = WalletLedgerEntry.create({
        id,
        wallet,
        transaction,
        type: 'BET',
        direction: 'DEBIT',
        money: Money.from({ amount: '1.00', currency: 'BRL' }),
        balanceBefore: Money.from({ amount: '2.00', currency: 'BRL' }),
        balanceAfter: Money.from({ amount: '1.00', currency: 'BRL' }),
        createdAt,
      });

      em.persist([transaction, entry]);
    }

    await em.flush();
  }

  it('returns a wallet with its money object and version', async () => {
    const wallet = await createWallet('25.50');
    const response = await request(app.getHttpServer()).get(
      `/wallets/${wallet.id}`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: wallet.id,
      playerId: expect.any(String),
      balance: { amount: '25.50', currency: 'BRL' },
      version: 1,
    });
  });

  it('returns 404 for an unknown wallet', async () => {
    const response = await request(app.getHttpServer()).get(
      `/wallets/${randomUUID()}`,
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      statusCode: 404,
      code: 'WALLET_NOT_FOUND',
      message: 'Carteira não encontrada.',
    });
  });

  it('returns an empty ledger for an existing wallet', async () => {
    const wallet = await createWallet();
    const response = await request(app.getHttpServer()).get(
      `/wallets/${wallet.id}/ledger`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: [],
      nextCursor: null,
      limit: 50,
    });
  });

  it('reconciles the stored wallet balance against its ledger', async () => {
    const wallet = await createWallet('25.50');
    const response = await request(app.getHttpServer())
      .post(`/wallets/${wallet.id}/reconciliation`)
      .send();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      walletId: wallet.id,
      storedBalance: { amount: '25.50', currency: 'BRL' },
      calculatedBalance: { amount: '25.50', currency: 'BRL' },
      difference: { amount: '0.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 1,
    });
  });

  it('reports readiness when PostgreSQL and SQS are available', async () => {
    const originalQueueUrl = process.env.SQS_QUEUE_URL;
    process.env.SQS_QUEUE_URL =
      'https://sqs.example.test/123/wagering-test-queue';

    try {
      const response = await request(app.getHttpServer()).get('/health/ready');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        checks: { database: 'up', sqs: 'up' },
      });
    } finally {
      if (originalQueueUrl === undefined) {
        delete process.env.SQS_QUEUE_URL;
      } else {
        process.env.SQS_QUEUE_URL = originalQueueUrl;
      }
    }
  });

  it('reports ledger mismatches, increments the metric, and leaves the wallet unchanged', async () => {
    const wallet = await createWallet('25.50');
    const em = orm.em.fork();
    const walletEntity = await em.findOneOrFail(Wallet, { id: wallet.id });
    const transactionId = randomUUID();
    const amount = Money.from({ amount: '2.50', currency: 'BRL' });
    const transaction = WagerTransaction.create({
      id: transactionId,
      wallet: walletEntity,
      providerId: `provider-${transactionId}`,
      externalTransactionId: `external-${transactionId}`,
      playerId: walletEntity.playerId,
      roundId: `round-${transactionId}`,
      gameId: `game-${transactionId}`,
      kind: WagerTransactionKind.Win,
      amount,
      idempotencyKey: `idempotency-${transactionId}`,
      payloadHash: `payload-${transactionId}`,
      createdAt: new Date(),
    });
    transaction.recordResultingBalance(
      Money.from({ amount: '28.00', currency: 'BRL' }),
    );
    const entry = WalletLedgerEntry.create({
      id: randomUUID(),
      wallet: walletEntity,
      transaction,
      type: 'WIN',
      direction: 'CREDIT',
      money: amount,
      balanceBefore: Money.from({ amount: '25.50', currency: 'BRL' }),
      balanceAfter: Money.from({ amount: '28.00', currency: 'BRL' }),
      createdAt: new Date(),
    });
    em.persist([transaction, entry]);
    await em.flush();

    const response = await request(app.getHttpServer())
      .post(`/wallets/${wallet.id}/reconciliation`)
      .send();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      walletId: wallet.id,
      storedBalance: { amount: '25.50', currency: 'BRL' },
      calculatedBalance: { amount: '28.00', currency: 'BRL' },
      difference: { amount: '2.50', currency: 'BRL' },
      consistent: false,
      checkedEntries: 2,
    });

    const unchangedWallet = await request(app.getHttpServer()).get(
      `/wallets/${wallet.id}`,
    );
    expect(unchangedWallet.body.balance).toEqual({
      amount: '25.50',
      currency: 'BRL',
    });

    const metrics = await request(app.getHttpServer()).get('/metrics');
    expect(metrics.text).toContain('wallet_reconciliation_mismatches_total 1');
  });

  it('returns opening entries with all money values and timestamps', async () => {
    const wallet = await createWallet('25.50');
    const response = await request(app.getHttpServer()).get(
      `/wallets/${wallet.id}/ledger`,
    );

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({
      transactionId: expect.any(String),
      type: 'OPENING',
      direction: 'CREDIT',
      amount: { amount: '25.50', currency: 'BRL' },
      balanceBefore: { amount: '0.00', currency: 'BRL' },
      balanceAfter: { amount: '25.50', currency: 'BRL' },
      createdAt: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      ),
    });
  });

  it('paginates in stable order when a newer entry arrives', async () => {
    const wallet = await createWallet();
    const idPrefix = randomUUID().split('-')[0];
    const ids = [
      `${idPrefix}-0000-4000-8000-000000000001`,
      `${idPrefix}-0000-4000-8000-000000000002`,
      `${idPrefix}-0000-4000-8000-000000000003`,
    ];
    await addBetEntries(wallet.id, ids);

    const firstPage = await request(app.getHttpServer())
      .get(`/wallets/${wallet.id}/ledger`)
      .query({ limit: '2' });

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.items.map((item: { id: string }) => item.id)).toEqual(
      [ids[2], ids[1]],
    );
    expect(firstPage.body.limit).toBe(2);
    expect(firstPage.body.nextCursor).toEqual(expect.any(String));

    const newerId = `${idPrefix}-0000-4000-8000-000000000004`;
    const em = orm.em.fork();
    const walletEntity = await em.findOneOrFail(Wallet, { id: wallet.id });
    const transactionId = randomUUID();
    const createdAt = new Date('2026-01-02T03:04:06.006Z');
    const transaction = WagerTransaction.create({
      id: transactionId,
      wallet: walletEntity,
      providerId: `provider-${transactionId}`,
      externalTransactionId: `external-${transactionId}`,
      playerId: walletEntity.playerId,
      roundId: `round-${transactionId}`,
      gameId: `game-${transactionId}`,
      kind: WagerTransactionKind.Bet,
      amount: Money.from({ amount: '1.00', currency: 'BRL' }),
      idempotencyKey: `idempotency-${transactionId}`,
      payloadHash: `payload-${transactionId}`,
      createdAt,
    });
    transaction.recordResultingBalance(
      Money.from({ amount: '1.00', currency: 'BRL' }),
    );
    const newerEntry = WalletLedgerEntry.create({
      id: newerId,
      wallet: walletEntity,
      transaction,
      type: 'BET',
      direction: 'DEBIT',
      money: Money.from({ amount: '1.00', currency: 'BRL' }),
      balanceBefore: Money.from({ amount: '2.00', currency: 'BRL' }),
      balanceAfter: Money.from({ amount: '1.00', currency: 'BRL' }),
      createdAt,
    });
    em.persist([transaction, newerEntry]);
    await em.flush();

    const nextPage = await request(app.getHttpServer())
      .get(`/wallets/${wallet.id}/ledger`)
      .query({ cursor: firstPage.body.nextCursor, limit: '2' });

    expect(nextPage.status).toBe(200);
    expect(nextPage.body.items.map((item: { id: string }) => item.id)).toEqual([
      ids[0],
    ]);
    expect(nextPage.body.nextCursor).toBeNull();

    const restarted = await request(app.getHttpServer())
      .get(`/wallets/${wallet.id}/ledger`)
      .query({ limit: '1' });
    expect(restarted.body.items[0].id).toBe(newerId);
  });

  it('validates cursor input before checking for the wallet', async () => {
    const response = await request(app.getHttpServer())
      .get(`/wallets/${randomUUID()}/ledger`)
      .query({ cursor: 'abc' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects unsupported and wallet mismatched cursors', async () => {
    const wallet = await createWallet();
    const timestamp = '2026-01-02T03:04:05.006Z';
    const cursorPayload = {
      v: 1,
      walletId: wallet.id,
      createdAt: timestamp,
      id: randomUUID(),
    };
    const unsupportedCursor = Buffer.from(
      JSON.stringify({ ...cursorPayload, v: 2 }),
    ).toString('base64url');
    const mismatchedCursor = Buffer.from(
      JSON.stringify({ ...cursorPayload, walletId: randomUUID() }),
    ).toString('base64url');

    for (const cursor of [unsupportedCursor, mismatchedCursor]) {
      const response = await request(app.getHttpServer())
        .get(`/wallets/${wallet.id}/ledger`)
        .query({ cursor });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects oversized and repeated query parameters', async () => {
    const wallet = await createWallet();
    const oversized = await request(app.getHttpServer())
      .get(`/wallets/${wallet.id}/ledger`)
      .query({ cursor: 'a'.repeat(513) });
    const repeated = await request(app.getHttpServer())
      .get(`/wallets/${wallet.id}/ledger`)
      .query('limit=2&limit=3');

    expect(oversized.status).toBe(400);
    expect(oversized.body.code).toBe('VALIDATION_ERROR');
    expect(repeated.status).toBe(400);
    expect(repeated.body.code).toBe('VALIDATION_ERROR');
  });
});
