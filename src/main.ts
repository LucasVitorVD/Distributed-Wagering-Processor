import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApplication } from './common/configure-application.js';
import { requestLogContextMiddleware } from './common/observability/request-log-context.js';
import { StructuredLogger } from './common/observability/structured-logger.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: new StructuredLogger(),
  });
  app.useLogger(app.get(StructuredLogger));
  app.use(requestLogContextMiddleware);
  configureApplication(app);
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
