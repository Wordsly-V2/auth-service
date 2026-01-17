import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  const appPort = configService.get<number>('port');
  const tcpPort = configService.get<number>('tcp.port');

  app.connectMicroservice<MicroserviceOptions>({
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    transport: Number(Transport.TCP),
    options: {
      host: '0.0.0.0',
      port: tcpPort,
    },
  });

  await app.startAllMicroservices();
  await app.listen(appPort as number);
  console.log(`Auth Service is running on port ${appPort}`);
  console.log(`Auth Service TCP is running on 0.0.0.0:${tcpPort}`);
}

bootstrap();
