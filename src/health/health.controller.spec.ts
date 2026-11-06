import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MetricsService } from '../common/metrics/metrics.module.js';
import { HealthController, MetricsController } from './health.controller.js';
import { HealthService } from './health.service.js';
import { requestLogContextMiddleware } from '../common/observability/request-log-context.js';

describe('health endpoints', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  async function createApp(readiness: {
    status: 'ok' | 'error';
    checks: { database: 'up' | 'down'; sqs: 'up' | 'down' };
  }) {
    const healthService = {
      checkReadiness: vi.fn().mockResolvedValue(readiness),
    };
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [HealthController, MetricsController],
      providers: [
        { provide: HealthService, useValue: healthService },
        MetricsService,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(requestLogContextMiddleware);
    await app.init();
    return app.getHttpServer();
  }

  it('returns a successful liveness response without dependency checks', async () => {
    const server = await createApp({
      status: 'ok',
      checks: { database: 'up', sqs: 'up' },
    });
    const response = await request(server).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('creates a correlation ID and returns it in the response header', async () => {
    const server = await createApp({
      status: 'ok',
      checks: { database: 'up', sqs: 'up' },
    });
    const response = await request(server).get('/health/live');

    expect(response.headers['x-correlation-id']).toEqual(
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
  });

  it('preserves a safe caller supplied correlation ID', async () => {
    const server = await createApp({
      status: 'ok',
      checks: { database: 'up', sqs: 'up' },
    });
    const response = await request(server)
      .get('/health/live')
      .set('x-correlation-id', 'trace:example-1');

    expect(response.headers['x-correlation-id']).toBe('trace:example-1');
  });

  it('returns 503 when a dependency is unavailable', async () => {
    const server = await createApp({
      status: 'error',
      checks: { database: 'up', sqs: 'down' },
    });
    const response = await request(server).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: 'error',
      checks: { database: 'up', sqs: 'down' },
    });
  });

  it('exposes reconciliation metrics in Prometheus format', async () => {
    const server = await createApp({
      status: 'ok',
      checks: { database: 'up', sqs: 'up' },
    });
    const response = await request(server).get('/metrics');

    expect(response.status).toBe(200);
    expect(response.text).toContain('wallet_reconciliation_mismatches_total');
  });
});
