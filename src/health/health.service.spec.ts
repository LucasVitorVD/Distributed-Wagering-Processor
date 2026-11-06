import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DatabaseReadinessCheck,
  SqsReadinessClient,
} from './health.tokens.js';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  const originalQueueUrl = process.env.SQS_QUEUE_URL;

  afterEach(() => {
    if (originalQueueUrl === undefined) {
      delete process.env.SQS_QUEUE_URL;
    } else {
      process.env.SQS_QUEUE_URL = originalQueueUrl;
    }
  });

  it('reports readiness when PostgreSQL and SQS are available', async () => {
    process.env.SQS_QUEUE_URL = 'https://sqs.example.test/123/queue';
    const database: DatabaseReadinessCheck = { check: vi.fn() };
    const getQueueAttributes = vi.fn();
    const sqs: SqsReadinessClient = {
      getQueueAttributes,
      destroy: vi.fn(),
    };
    const service = new HealthService(database, sqs);

    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up', sqs: 'up' },
    });
    expect(getQueueAttributes).toHaveBeenCalledWith(
      'https://sqs.example.test/123/queue',
    );
  });

  it('reports dependencies that fail their readiness checks', async () => {
    process.env.SQS_QUEUE_URL = 'https://sqs.example.test/123/queue';
    const database: DatabaseReadinessCheck = {
      check: vi.fn().mockRejectedValue(new Error('database unavailable')),
    };
    const sqs: SqsReadinessClient = {
      getQueueAttributes: vi
        .fn()
        .mockRejectedValue(new Error('queue unavailable')),
      destroy: vi.fn(),
    };
    const service = new HealthService(database, sqs);

    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'error',
      checks: { database: 'down', sqs: 'down' },
    });
  });

  it('does not report ready when the queue URL is missing', async () => {
    delete process.env.SQS_QUEUE_URL;
    const database: DatabaseReadinessCheck = { check: vi.fn() };
    const getQueueAttributes = vi.fn();
    const sqs: SqsReadinessClient = {
      getQueueAttributes,
      destroy: vi.fn(),
    };
    const service = new HealthService(database, sqs);

    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'error',
      checks: { database: 'up', sqs: 'down' },
    });
    expect(getQueueAttributes).not.toHaveBeenCalled();
  });
});
