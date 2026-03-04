import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const apiPort = Number(process.env.API_PORT || process.env.PORT || 4000);
  const webOrigin = process.env.WEB_ORIGIN || 'http://localhost:3000';

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
}
bootstrap();
