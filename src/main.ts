import { AppModule } from '@/app.module';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const appPort = configService.get<number>('port');

  await app.listen(appPort as number);
  console.log(`Auth Service HTTP is running on port ${appPort}`);
}

void bootstrap();
