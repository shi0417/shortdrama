import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as express from 'express';
import { AppModule } from './app.module';

const BODY_LIMIT = '20mb';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const apiPort = Number(process.env.API_PORT || process.env.PORT || 4000);
  const webOrigin = process.env.WEB_ORIGIN || 'http://localhost:3000';

  app.use(express.json({ limit: BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

  app.enableCors({
    origin: [webOrigin, 'http://localhost:3001'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  await app.listen(apiPort);
  console.log(`🚀 API server running on http://localhost:${apiPort}`);
  console.log(`🔧 API_PORT=${process.env.API_PORT || 'undefined'} PORT=${process.env.PORT || 'undefined'}`);
  console.log(`📦 Body limit: ${BODY_LIMIT}`);
}
bootstrap();
