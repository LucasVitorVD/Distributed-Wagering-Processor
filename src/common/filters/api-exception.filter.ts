import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  DifferentCurrencyError,
  InvalidMoneyError,
} from '../../domain/shared/money.js';
import {
  DomainError,
  DuplicateWagerTransactionError,
  IdempotencyConflictError,
  WalletNotFoundError,
  WagerTransactionNotFoundError,
} from '../../domain/shared/errors.js';

interface ApiErrorResponse {
  statusCode: number;
  code: string;
  message: string;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<{
      status: (statusCode: number) => {
        json: (body: ApiErrorResponse) => void;
      };
    }>();
    const errorResponse = this.toResponse(exception);

    if (errorResponse.statusCode === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error('Unexpected error while handling request.');
    }

    response.status(errorResponse.statusCode).json(errorResponse);
  }

  private toResponse(exception: unknown): ApiErrorResponse {
    if (
      exception instanceof IdempotencyConflictError ||
      exception instanceof DuplicateWagerTransactionError
    ) {
      return {
        statusCode: HttpStatus.CONFLICT,
        code: exception.code,
        message: exception.message,
      };
    }

    if (exception instanceof WagerTransactionNotFoundError) {
      return {
        statusCode: HttpStatus.NOT_FOUND,
        code: exception.code,
        message: exception.message,
      };
    }

    if (
      exception instanceof UniqueConstraintViolationException &&
      this.getConstraintName(exception) === 'uq_wallets_player_currency'
    ) {
      return {
        statusCode: HttpStatus.CONFLICT,
        code: 'WALLET_ALREADY_EXISTS',
        message: 'Já existe uma carteira para este jogador.',
      };
    }

    if (exception instanceof WalletNotFoundError) {
      return {
        statusCode: HttpStatus.NOT_FOUND,
        code: exception.code,
        message: exception.message,
      };
    }

    if (
      exception instanceof DomainError ||
      exception instanceof InvalidMoneyError ||
      exception instanceof DifferentCurrencyError
    ) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        code: exception.code,
        message: exception.message,
      };
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      const responseBody =
        typeof exceptionResponse === 'object' && exceptionResponse !== null
          ? exceptionResponse
          : undefined;
      const code =
        responseBody && 'code' in responseBody ? responseBody.code : undefined;
      const message =
        responseBody && 'message' in responseBody
          ? responseBody.message
          : undefined;

      if (typeof code === 'string' && typeof message === 'string') {
        return { statusCode, code, message };
      }

      if (exception instanceof BadRequestException) {
        return {
          statusCode,
          code: 'BAD_REQUEST',
          message: 'Requisição inválida.',
        };
      }

      return {
        statusCode,
        code: this.httpCode(statusCode),
        message: 'Não foi possível processar a requisição.',
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Erro interno do servidor.',
    };
  }

  private getConstraintName(exception: UniqueConstraintViolationException) {
    let current: unknown = exception;

    while (typeof current === 'object' && current !== null) {
      if ('constraint' in current && typeof current.constraint === 'string') {
        return current.constraint;
      }
      current = 'cause' in current ? current.cause : undefined;
    }

    return undefined;
  }

  private httpCode(statusCode: number): string {
    if (statusCode === HttpStatus.NOT_FOUND) {
      return 'NOT_FOUND';
    }
    if (statusCode === HttpStatus.CONFLICT) {
      return 'CONFLICT';
    }
    return 'HTTP_ERROR';
  }
}
