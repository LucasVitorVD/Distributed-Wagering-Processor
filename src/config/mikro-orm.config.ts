import { ReflectMetadataProvider, defineConfig } from '@mikro-orm/core';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';

export default defineConfig({
  dbName: process.env.POSTGRES_DB ?? 'wagering',
  user: process.env.POSTGRES_USER ?? 'wagering',
  password: process.env.POSTGRES_PASSWORD ?? 'wagering',
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5433),
  entities: ['./dist/**/*.entity.js'],
  entitiesTs: ['./src/**/*.entity.ts'],
  metadataProvider: ReflectMetadataProvider,
  driver: PostgreSqlDriver,
});
