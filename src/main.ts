import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from '@/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const appPort = configService.get<number>('port');
  const tcpPort = configService.get<number>('tcp.port');

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.TCP,
    options: {
      host: '0.0.0.0',
      port: tcpPort,
    },
  });

  await app.startAllMicroservices();
  await app.listen(appPort as number);
  console.log(`Auth Service HTTP is running on port ${appPort}`);
  console.log(`Auth Service TCP is running on port ${tcpPort}`);
}

void bootstrap();
