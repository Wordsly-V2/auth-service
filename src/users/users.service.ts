import { PrismaService } from '@/prisma/prisma.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import { IUser } from './DTO/users.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prismaService: PrismaService) {}
  async getProfile(userLoginId: string): Promise<IUser> {
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
