import { Injectable, type LoggerService } from '@nestjs/common';
import { requestLogContext } from './request-log-context.js';

export type StructuredLogLevel = 'info' | 'warn' | 'error';

export interface StructuredLogFields {
  transactionId?: string | null;
  walletId?: string | null;
  providerId?: string | null;
  code?: string;
}

@Injectable()
export class StructuredLogger implements LoggerService {
  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', this.safeMessage(message), optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', this.safeMessage(message), optionalParams);
  }

  error(_message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', 'Application error', optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', this.safeMessage(message), optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', this.safeMessage(message), optionalParams);
  }

  fatal(_message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', 'Application error', optionalParams);
  }

  info(message: string, fields: StructuredLogFields = {}): void {
    this.writeEvent('info', message, fields);
  }

  warnEvent(message: string, fields: StructuredLogFields = {}): void {
    this.writeEvent('warn', message, fields);
  }

  errorEvent(message: string, fields: StructuredLogFields = {}): void {
    this.writeEvent('error', message, fields);
  }

  private write(
    level: StructuredLogLevel,
    message: string,
    optionalParams: unknown[],
  ): void {
    const context =
      typeof optionalParams.at(-1) === 'string'
        ? String(optionalParams.at(-1))
        : undefined;
    this.writeEvent(level, message, {}, context);
  }

  private writeEvent(
    level: StructuredLogLevel,
    message: string,
    fields: StructuredLogFields,
    context?: string,
  ): void {
    const requestContext = requestLogContext.getStore();
    const record = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(context ? { context } : {}),
      correlationId: requestContext?.correlationId ?? null,
      messageId: requestContext?.messageId ?? null,
      transactionId:
        fields.transactionId ?? requestContext?.transactionId ?? null,
      walletId: fields.walletId ?? requestContext?.walletId ?? null,
      providerId: fields.providerId ?? requestContext?.providerId ?? null,
      ...(fields.code ? { code: fields.code } : {}),
    };

    console.log(JSON.stringify(record));
  }

  private safeMessage(message: unknown): string {
    return typeof message === 'string' ? message : 'Application event';
  }
}
