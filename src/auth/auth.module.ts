import { AuthCookieService } from '@/auth/auth-cookie.service';
import { AuthController } from '@/auth/auth.controller';
import { AuthService } from '@/auth/auth.service';
import { AuthSessionController } from '@/auth/auth-session.controller';
import { GoogleStrategy } from '@/auth/strategy/google.strategy';
import { RefreshTokenCleanupService } from '@/auth/refresh-token-cleanup.service';
import { Module } from '@nestjs/common';

@Module({
    controllers: [AuthController, AuthSessionController],
    providers: [
        AuthService,
        AuthCookieService,
        GoogleStrategy,
        RefreshTokenCleanupService,
    ],
})
export class AuthModule {}
