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

describe('POST /wallets', () => {
  let app: Awaited<ReturnType<TestingModule['createNestApplication']>>;
  const service = {
    create: vi.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WalletsController],
      providers: [{ provide: WalletCreationService, useValue: service }],
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
      balance: '25.50',
      version: 1,
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
      balance: '25.50',
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
});
