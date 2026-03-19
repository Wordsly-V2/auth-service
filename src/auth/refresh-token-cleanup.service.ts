import { PrismaService } from '@/prisma/prisma.service';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class RefreshTokenCleanupService implements OnModuleInit {
  private readonly logger = new Logger(RefreshTokenCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.clearExpiredRefreshTokens();
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async clearExpiredRefreshTokensCron(): Promise<void> {
    await this.clearExpiredRefreshTokens();
  }

  private async clearExpiredRefreshTokens(): Promise<void> {
    const result = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (result.count > 0) {
      this.logger.log(`Removed ${result.count} expired refresh token(s)`);
    }
  }
}
