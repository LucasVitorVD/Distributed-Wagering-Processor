import { Test, type TestingModule } from '@nestjs/testing';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import request from 'supertest';
import { configureApplication } from '../src/common/configure-application.js';
import { InvalidAmountError } from '../src/domain/shared/errors.js';
import { WalletsController } from '../src/wallets/wallets.controller.js';
import { WalletCreationService } from '../src/wallets/wallet-creation.service.js';
import { WalletQueryService } from '../src/wallets/wallet-query.service.js';
import { WalletReconciliationService } from '../src/wallets/wallet-reconciliation.service.js';

describe('POST /wallets', () => {
  let app: Awaited<ReturnType<TestingModule['createNestApplication']>>;
  const service = {
    create: vi.fn(),
  };
  const queryService = {
    findWallet: vi.fn(),
    findLedger: vi.fn(),
  };
  const reconciliationService = {
    reconcile: vi.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WalletsController],
      providers: [
        { provide: WalletCreationService, useValue: service },
        { provide: WalletQueryService, useValue: queryService },
        { provide: WalletReconciliationService, useValue: reconciliationService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    service.create.mockResolvedValue({
      id: 'c04e4200-3f21-4c87-94f1-0e50032cc554',
      playerId: '2f986158-4ec9-4c7f-8ca1-f790a83af8df',
      balance: { amount: '25.50', currency: 'BRL' },
      version: 1,
    });
    queryService.findWallet.mockResolvedValue({
      id: 'c04e4200-3f21-4c87-94f1-0e50032cc554',
      playerId: '2f986158-4ec9-4c7f-8ca1-f790a83af8df',
      balance: { amount: '25.50', currency: 'BRL' },
      version: 1,
    });
    queryService.findLedger.mockResolvedValue({
      items: [],
      nextCursor: null,
      limit: 50,
    });
    reconciliationService.reconcile.mockResolvedValue({
      walletId: 'c04e4200-3f21-4c87-94f1-0e50032cc554',
      storedBalance: { amount: '25.50', currency: 'BRL' },
      calculatedBalance: { amount: '25.50', currency: 'BRL' },
      difference: { amount: '0.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 0,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the created wallet with HTTP 201', async () => {
    const response = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId: '2f986158-4ec9-4c7f-8ca1-f790a83af8df',
        initialBalance: { amount: '25.5', currency: 'BRL' },
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: 'c04e4200-3f21-4c87-94f1-0e50032cc554',
      playerId: '2f986158-4ec9-4c7f-8ca1-f790a83af8df',
      balance: { amount: '25.50', currency: 'BRL' },
      version: 1,
    });
    expect(service.create).toHaveBeenCalledWith({
      playerId: '2f986158-4ec9-4c7f-8ca1-f790a83af8df',
      initialBalance: { amount: '25.5', currency: 'BRL' },
    });
  });

  it.each([
    ['UUID inválido', { playerId: 'not-a-uuid' }],
    ['valor numérico', { initialBalance: { amount: 25, currency: 'BRL' } }],
    ['moeda diferente', { initialBalance: { amount: '1', currency: 'USD' } }],
    ['valor negativo', { initialBalance: { amount: '-1', currency: 'BRL' } }],
    ['zeros à esquerda', { initialBalance: { amount: '01', currency: 'BRL' } }],
    [
      'mais de duas casas',
      { initialBalance: { amount: '1.001', currency: 'BRL' } },
    ],
    [
      'acima do máximo',
      { initialBalance: { amount: '10000000000000000', currency: 'BRL' } },
    ],
    ['campo extra', { extra: true }],
    [
      'campo extra aninhado',
      { initialBalance: { amount: '1', currency: 'BRL', extra: true } },
    ],
  ])('rejeita %s com formato de erro de validação', async (_case, input) => {
    const response = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId: '2f986158-4ec9-4c7f-8ca1-f790a83af8df',
        initialBalance: { amount: '1', currency: 'BRL' },
        ...input,
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(response.body.message).toEqual(expect.any(String));
    expect(service.create).not.toHaveBeenCalled();
  });

  it('mapeia somente a constraint de wallet duplicada para HTTP 409', async () => {
    const databaseError = Object.assign(new Error('duplicate'), {
      constraint: 'uq_wallets_player_currency',
    });
    service.create.mockRejectedValue(
      new UniqueConstraintViolationException(databaseError),
    );

    const response = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId: '2f986158-4ec9-4c7f-8ca1-f790a83af8df',
        initialBalance: { amount: '1', currency: 'BRL' },
      });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      statusCode: 409,
      code: 'WALLET_ALREADY_EXISTS',
      message: 'Já existe uma carteira para este jogador.',
    });
  });

  it('preserva o código de erro de domínio', async () => {
    service.create.mockRejectedValue(new InvalidAmountError());

    const response = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId: '2f986158-4ec9-4c7f-8ca1-f790a83af8df',
        initialBalance: { amount: '1', currency: 'BRL' },
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'INVALID_AMOUNT',
      message: 'O valor deve ser positivo',
    });
  });

  it('oculta detalhes de falhas inesperadas', async () => {
    service.create.mockRejectedValue(new Error('internal database details'));

    const response = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId: '2f986158-4ec9-4c7f-8ca1-f790a83af8df',
        initialBalance: { amount: '1', currency: 'BRL' },
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Erro interno do servidor.',
    });
  });

  it('retorna os dados da carteira com GET /wallets/:walletId', async () => {
    const response = await request(app.getHttpServer()).get(
      '/wallets/c04e4200-3f21-4c87-94f1-0e50032cc554',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: 'c04e4200-3f21-4c87-94f1-0e50032cc554',
      playerId: '2f986158-4ec9-4c7f-8ca1-f790a83af8df',
      balance: { amount: '25.50', currency: 'BRL' },
      version: 1,
    });
  });

  it('retorna paginação padrão do ledger', async () => {
    const response = await request(app.getHttpServer()).get(
      '/wallets/c04e4200-3f21-4c87-94f1-0e50032cc554/ledger',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: [],
      nextCursor: null,
      limit: 50,
    });
    expect(queryService.findLedger).toHaveBeenCalledWith(
      'c04e4200-3f21-4c87-94f1-0e50032cc554',
      {},
    );
  });

  it.each(['0', '01', '-1', '1.0', '1e1', '101', ' 2'])(
    'rejeita limite inválido %s',
    async (limit) => {
      const response = await request(app.getHttpServer())
        .get('/wallets/c04e4200-3f21-4c87-94f1-0e50032cc554/ledger')
        .query({ limit });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(queryService.findLedger).not.toHaveBeenCalled();
    },
  );

  it('rejeita UUID inválido antes de consultar', async () => {
    const response = await request(app.getHttpServer()).get(
      '/wallets/not-a-uuid',
    );

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(queryService.findWallet).not.toHaveBeenCalled();
  });
});
