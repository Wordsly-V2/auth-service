import { register } from 'tsconfig-paths';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { resolve } from 'path';
import { AppModule } from './app.module';

register({
  baseUrl: __dirname,
  paths: {
    '@/*': [resolve(__dirname, './*')],
  },
});

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
