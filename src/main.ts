import { AppModule } from '@/app.module';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { buildCorsOptions, parseCorsOrigins } from '@/config/cors';
import cookieParser from 'cookie-parser';

async function bootstrap() {
    const app = await NestFactory.create<NestExpressApplication>(AppModule);

    const configService = app.get(ConfigService);

    // This service sits behind the gateway, so without this every request's IP
    // is the gateway's. The refresh flow records the IP a token was issued to
    // and warns on a change; collapsing every client to one address would make
    // that signal meaningless.
    const trustProxyHops = configService.get<number>('trustProxyHops') ?? 0;
    if (trustProxyHops > 0) {
        app.set('trust proxy', trustProxyHops);
    }

    // The refresh token arrives as a cookie in the default delivery mode.
    app.use(cookieParser());

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
