import { randomUUID } from 'node:crypto';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { MikroORM } from '@mikro-orm/postgresql';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureApplication } from '../src/common/configure-application.js';
import { WalletLedgerEntry } from '../src/domain/ledger/wallet-ledger-entry.entity.js';
import { Wallet } from '../src/domain/wallet/wallet.entity.js';
import {
  WagerTransaction,
  WagerTransactionStatus,
} from '../src/domain/wagering/wager-transaction.entity.js';
import config from '../src/config/mikro-orm.config.js';
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

describe('wallet creation API with PostgreSQL', () => {
  let app: INestApplication;
  let orm: MikroORM;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [MikroOrmModule.forRoot(databaseConfig), WalletsModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    orm = app.get(MikroORM);
    await orm.getMigrator().up();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates and persists wallet, opening transaction, and ledger entry', async () => {
    const playerId = randomUUID();
    const response = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId,
        initialBalance: { amount: '32.75', currency: 'BRL' },
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: expect.any(String),
      playerId,
      balance: { amount: '32.75', currency: 'BRL' },
      version: 1,
    });

    const em = orm.em.fork();
    const wallet = await em.findOne(Wallet, { id: response.body.id });
    const transaction = await em.findOne(WagerTransaction, {
      idempotencyKey: `wallet-opening:${response.body.id}`,
    });
    const entries = transaction
      ? await em.find(WalletLedgerEntry, { transaction: transaction.id })
      : [];

    expect(wallet?.balance.toJSON().amount).toBe('32.75');
    expect(transaction?.status).toBe(WagerTransactionStatus.Processed);
    expect(transaction?.providerId).toBeNull();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: 'OPENING',
      direction: 'CREDIT',
      moneyAmount: '32.75',
      balanceBeforeAmount: '0.00',
      balanceAfterAmount: '32.75',
    });
  });

  it('creates only a wallet for a zero balance', async () => {
    const playerId = randomUUID();
    const response = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId,
        initialBalance: { amount: '0.00', currency: 'BRL' },
      });

    expect(response.status).toBe(201);
    expect(response.body.balance).toEqual({
      amount: '0.00',
      currency: 'BRL',
    });
    const em = orm.em.fork();
    expect(await em.count(WagerTransaction, { wallet: response.body.id })).toBe(
      0,
    );
    expect(
      await em.count(WalletLedgerEntry, { wallet: response.body.id }),
    ).toBe(0);
  });

  it('returns a conflict for a duplicate wallet', async () => {
    const playerId = randomUUID();
    const payload = {
      playerId,
      initialBalance: { amount: '0', currency: 'BRL' },
    };

    expect(
      (await request(app.getHttpServer()).post('/wallets').send(payload))
        .status,
    ).toBe(201);

    const duplicate = await request(app.getHttpServer())
      .post('/wallets')
      .send(payload);

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('WALLET_ALREADY_EXISTS');
  });

  it('rejects invalid input before writing to PostgreSQL', async () => {
    const playerId = randomUUID();
    const response = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId,
        initialBalance: { amount: '01', currency: 'BRL' },
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(await orm.em.fork().count(Wallet, { playerId })).toBe(0);
  });
});
