import { AuthController } from '@/auth/auth.controller';
import { AuthService } from '@/auth/auth.service';
import { RefreshTokenCleanupService } from '@/auth/refresh-token-cleanup.service';
import { Module } from '@nestjs/common';

@Module({
  controllers: [AuthController],
  providers: [AuthService, RefreshTokenCleanupService],
})
export class AuthModule {}
