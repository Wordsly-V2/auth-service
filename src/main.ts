import 'tsconfig-paths/register';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';

async function bootstrap() {
  const context = await NestFactory.createApplicationContext(AppModule);
  const configService = context.get(ConfigService);
  const tcpPort = configService.get<number>('tcp.port');

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.TCP,
      options: {
        host: '0.0.0.0',
        port: tcpPort,
      },
    },
  );

  await app.listen();
  console.log(`Auth Service TCP is running on 0.0.0.0:${tcpPort}`);
}

void bootstrap();
