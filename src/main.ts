import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApplication } from './common/configure-application.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApplication(app);
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
