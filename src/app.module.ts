import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';
import { AuthModule } from '@/auth/auth.module';
import { CacheModule } from '@/cache/cache.module';
import { TokenModule } from '@/auth/token.module';
import { AccessGuard } from '@/common/guard/access.guard';
import { OwnerGuard } from '@/common/guard/owner.guard';
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
    // Order matters: AccessGuard attaches the identity that OwnerGuard checks.
    // Registering globally makes the service deny-by-default, so a controller
    // that forgets a decorator fails closed rather than becoming public.
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_GUARD, useClass: OwnerGuard },
  ],
})
export class AppModule {}
