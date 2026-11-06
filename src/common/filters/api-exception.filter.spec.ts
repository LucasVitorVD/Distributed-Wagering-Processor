import { type ArgumentsHost, Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { WalletNotFoundError } from '../../domain/shared/errors.js';
import { ApiExceptionFilter } from './api-exception.filter.js';

describe('ApiExceptionFilter', () => {
  function createHost() {
    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
      }),
    } as ArgumentsHost;

    return { host, response };
  }

  it('maps a missing wallet to the public not found response', () => {
    const filter = new ApiExceptionFilter();
    const { host, response } = createHost();

    filter.catch(new WalletNotFoundError(), host);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 404,
      code: 'WALLET_NOT_FOUND',
      message: 'Carteira não encontrada.',
    });
  });

  it('logs a generic message without exception details', () => {
    const filter = new ApiExceptionFilter();
    const { host } = createHost();
    const loggerError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const secretError = new Error(
      'select * from wallet_ledger_entries where amount = 25.00',
    );

    filter.catch(secretError, host);

    expect(loggerError).toHaveBeenCalledWith(
      'Unexpected error while handling request.',
    );
    expect(loggerError.mock.calls.flat().join(' ')).not.toContain('select');
    expect(loggerError.mock.calls.flat().join(' ')).not.toContain('25.00');
    loggerError.mockRestore();
  });
});
