// Before anything else: decorators read and write design-time type metadata as
// their modules load, and a DTO that loads ahead of Nest's own import of this
// polyfill crashes the boot (`@Type`) or silently loses its types (implicit
// query conversion).
import 'reflect-metadata';
import { AppModule } from '@/app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { buildCorsOptions, parseCorsOrigins } from '@/config/cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { requestIdMiddleware } from '@/common/request-id.middleware';
import { RequestContextLogger } from '@/common/request-context-logger';

const bootLogger = new Logger('Bootstrap');

async function bootstrap() {
    const app = await NestFactory.create<NestExpressApplication>(AppModule);

    app.useLogger(app.get(RequestContextLogger));

    // First, so every later middleware, guard and handler runs inside
    // the store and logs the same id the caller was given back.
    app.use(requestIdMiddleware);

    // Baseline security headers (HSTS, nosniff, frameguard, referrer policy).
    app.use(helmet());

    const configService = app.get(ConfigService);

    // This service sits behind the gateway, so without this every request's IP
    // is the gateway's. The refresh flow records the IP a token was issued to
    // and warns on a change; collapsing every client to one address would make
    // that signal meaningless.
    const trustProxyHops = configService.get<number>('trustProxyHops') ?? 0;
    if (trustProxyHops > 0) {
        app.set('trust proxy', trustProxyHops);
    }

    // Identical to the pipe vocabulary- and learning-service register. This
    // service had none at all, and its DTOs were interfaces — erased at runtime
    // — so a request body reached the handler exactly as sent.
    app.useGlobalPipes(
        new ValidationPipe({
            transform: true,
            whitelist: true,
            transformOptions: {
                enableImplicitConversion: true,
            },
        }),
    );

    // The refresh token arrives as a cookie in the default delivery mode.
    app.use(cookieParser());

    const corsEnabledOrigins = configService.get<string>('corsEnabledOrigins');

    app.enableCors(buildCorsOptions(corsEnabledOrigins));

    const appPort = configService.get<number>('port');

    await app.listen(appPort as number);
    bootLogger.log(`Auth Service HTTP is running on port ${appPort}`);
    bootLogger.log(
        `CORS enabled origins: ${parseCorsOrigins(corsEnabledOrigins).join(', ') || 'none'}`,
    );
}

void bootstrap();
