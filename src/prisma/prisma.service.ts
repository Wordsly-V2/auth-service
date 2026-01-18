import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await this.$connect().catch((error: unknown) => {
      console.error('Error connecting to database', error as Error);
      throw error;
    });
  }

  async onModuleDestroy() {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await this.$disconnect().catch((error: unknown) => {
      console.error('Error disconnecting from database', error as Error);
      throw error;
    });
  }

  enableShutdownHooks() {
    this.$on('beforeExit', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await this.$disconnect().catch((error: unknown) => {
        console.error('Error disconnecting from database', error as Error);
        throw error;
      });
    });
  }
}
