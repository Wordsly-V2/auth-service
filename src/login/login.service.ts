import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { IOAuthLoginResponseDTO, IOAuthUserDTO } from '@/login/DTO/login.DTO';
import { PrismaClient, User, UserLogin } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

@Injectable()
export class LoginService {
  constructor(private readonly prismaService: PrismaService) {}

  async handleOAuthLogin(
    userPayload: IOAuthUserDTO,
  ): Promise<IOAuthLoginResponseDTO> {
    let userLogin: UserLogin | null = null;
    let user: User | null = null;
    const now = new Date();

    await this.prismaService.$transaction(async (tx: PrismaClient) => {
      const existingUserLogin = await tx.userLogin.findFirst({
        where: {
          OR: [
            { googleId: userPayload.id },
            { facebookId: userPayload.id },
            { gmail: userPayload.email },
          ],
        },
      });

      switch (userPayload.provider) {
        case 'google': {
          userLogin = await tx.userLogin.upsert({
            where: {
              id: existingUserLogin?.id ?? '0',
            },
            update: { gmail: userPayload.email, googleId: userPayload.id },
            create: {
              gmail: userPayload.email,
              googleId: userPayload.id,
              id: uuidv7(),
              createdAt: now,
              updatedAt: now,
            },
          });
          break;
        }
        case 'facebook': {
          userLogin = await tx.userLogin.upsert({
            where: {
              id: existingUserLogin?.id ?? '0',
            },
            update: { gmail: userPayload.email, facebookId: userPayload.id },
            create: {
              gmail: userPayload.email,
              facebookId: userPayload.id,
              id: uuidv7(),
              createdAt: now,
              updatedAt: now,
            },
          });
          break;
        }
      }

      user = await tx.user.upsert({
        where: {
          userLoginId: userLogin.id,
        },
        update: {
          displayName: userPayload.displayName,
          pictureUrl: userPayload.picture,
          updatedAt: now,
        },
        create: {
          id: uuidv7(),
          userLoginId: userLogin.id,
          displayName: userPayload.displayName,
          pictureUrl: userPayload.picture,
          createdAt: now,
          updatedAt: now,
        },
      });
    });

    console.log(user);
    console.log(userLogin);

    return {
      accessToken: 'accessToken',
      refreshToken: 'refreshToken',
    };
  }
}
