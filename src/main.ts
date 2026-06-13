import { AppModule } from '@/app.module';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { buildCorsOptions, parseCorsOrigins } from '@/config/cors';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    const configService = app.get(ConfigService);
    const corsEnabledOrigins = configService.get<string>('corsEnabledOrigins');

    const corsOptions = buildCorsOptions(corsEnabledOrigins);
    if (corsOptions) {
        app.enableCors(corsOptions);
    }

    const appPort = configService.get<number>('port');

    await app.listen(appPort as number);
    console.log(`Auth Service HTTP is running on port ${appPort}`);
    console.log(
        `CORS enabled origins: ${parseCorsOrigins(corsEnabledOrigins).join(', ') || 'none'}`,
    );
}

void bootstrap();
