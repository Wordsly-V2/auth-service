import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';
import { AuthModule } from '@/auth/auth.module';
import { CacheModule } from '@/cache/cache.module';
import { TokenModule } from '@/auth/token.module';
import { AccessGuard } from '@/common/guard/access.guard';
import { UserScopeGuard } from '@/common/guard/user-scope.guard';
import configuration from '@/config/configuration';
import { validateEnv } from '@/config/validate-env';
import { KeysModule } from '@/keys/keys.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { UsersModule } from '@/users/users.module';
import { WellKnownModule } from '@/well-known/well-known.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
    imports: [
        ScheduleModule.forRoot(),
        ConfigModule.forRoot({
            isGlobal: true,
            load: [configuration],
            validate: validateEnv,
        }),
        KeysModule,
        TokenModule,
        CacheModule,
        AuthModule,
        PrismaModule,
        UsersModule,
        WellKnownModule,
    ],
    controllers: [AppController],
    providers: [
        AppService,
        // Registering globally makes the service deny-by-default, so a controller
        // that forgets a decorator fails closed rather than becoming public.
        // AccessGuard establishes who the caller is; UserScopeGuard makes sure the
        // request did not try to name someone else.
        { provide: APP_GUARD, useClass: AccessGuard },
        { provide: APP_GUARD, useClass: UserScopeGuard },
    ],
})
export class AppModule {}
