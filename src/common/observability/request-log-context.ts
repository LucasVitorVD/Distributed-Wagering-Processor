import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';

export interface RequestLogContext {
  correlationId: string;
  messageId: null;
  transactionId: string | null;
  walletId: string | null;
  providerId: string | null;
}

export const requestLogContext = new AsyncLocalStorage<RequestLogContext>();

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export const requestLogContextMiddleware: RequestHandler = (
  request,
  response,
  next,
) => {
  const suppliedId = request.header('x-correlation-id');
  const correlationId =
    suppliedId && CORRELATION_ID_PATTERN.test(suppliedId)
      ? suppliedId
      : randomUUID();

  response.setHeader('x-correlation-id', correlationId);
  requestLogContext.run(
    {
      correlationId,
      messageId: null,
      transactionId: null,
      walletId: null,
      providerId: null,
    },
    next,
  );
};
