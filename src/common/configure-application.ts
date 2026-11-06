import {
  BadRequestException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { ApiExceptionFilter } from '../common/filters/api-exception.filter.js';

export function configureApplication(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: false },
      exceptionFactory: (errors) =>
        new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: formatValidationErrors(errors),
        }),
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
}

function formatValidationErrors(errors: ValidationError[]): string {
  const messages = new Set<string>();

  const collect = (error: ValidationError): void => {
    for (const [constraint, message] of Object.entries(
      error.constraints ?? {},
    )) {
      messages.add(
        constraint === 'whitelistValidation'
          ? `A propriedade ${error.property} não é permitida.`
          : message,
      );
    }
    error.children?.forEach(collect);
  };

  errors.forEach(collect);
  return [...messages].join(' ');
}
