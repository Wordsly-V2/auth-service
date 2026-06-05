import { cacheKeys } from '@/cache/cache-keys';
import { CacheKind } from '@/cache/cache-ttl';
import { CacheService } from '@/cache/cache.service';
import { PrismaService } from '@/prisma/prisma.service';
import { IUser } from '@/users/dto/users.dto';
import { Injectable, NotFoundException } from '@nestjs/common';

@Injectable()
export class UsersService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  async getProfile(userLoginId: string): Promise<IUser> {
    return this.cacheService.getOrSet(
      userLoginId,
      [cacheKeys.userProfile()],
      () => this.fetchProfile(userLoginId),
      CacheKind.UserProfile,
    );
  }

  private async fetchProfile(userLoginId: string): Promise<IUser> {
    const user = await this.prismaService.user.findUnique({
      where: {
        userLoginId,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      id: user.id,
      gmail: user.gmail,
      displayName: user.displayName,
      pictureUrl: user.pictureUrl,
    };
  }
}
