import { AppModule } from '@/app.module';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    const configService = app.get(ConfigService);

    const corsEnabledOrigins = (
        configService.get<string>('corsEnabledOrigins') ?? ''
    ).split(',');

    app.enableCors({
        origin: corsEnabledOrigins,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    });

    const appPort = configService.get<number>('port');

    await app.listen(appPort as number);
    console.log(`Auth Service HTTP is running on port ${appPort}`);
    console.log(`CORS enabled origins: ${corsEnabledOrigins.join(', ')}`);
}

void bootstrap();
