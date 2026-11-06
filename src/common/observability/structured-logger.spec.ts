import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  requestLogContext,
  type RequestLogContext,
} from './request-log-context.js';
import { StructuredLogger } from './structured-logger.js';

describe('StructuredLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes JSON logs with request and transaction identifiers only', () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const logger = new StructuredLogger();
    const context: RequestLogContext = {
      correlationId: 'trace-1',
      messageId: null,
      transactionId: null,
      walletId: null,
      providerId: null,
    };

    requestLogContext.run(context, () => {
      logger.info('Wagering transaction processed.', {
        transactionId: 'transaction-1',
        walletId: 'wallet-1',
        providerId: 'provider-1',
      });
    });

    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toEqual({
      timestamp: expect.any(String),
      level: 'info',
      message: 'Wagering transaction processed.',
      correlationId: 'trace-1',
      messageId: null,
      transactionId: 'transaction-1',
      walletId: 'wallet-1',
      providerId: 'provider-1',
    });
  });

  it('does not write exception messages or non string payloads', () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const logger = new StructuredLogger();

    logger.error('financial request payload: 999.00');
    logger.log({ amount: '999.00' });

    const records = output.mock.calls.map(([record]) =>
      JSON.parse(String(record)),
    );
    expect(records[0]).toMatchObject({
      level: 'error',
      message: 'Application error',
      correlationId: null,
      messageId: null,
      transactionId: null,
      walletId: null,
      providerId: null,
    });
    expect(records[1].message).toBe('Application event');
    expect(JSON.stringify(records)).not.toContain('999.00');
  });
});
