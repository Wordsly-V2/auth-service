import { IOAuthLoginResponseDTO, IOAuthUserDTO } from '@/login/DTO/login.DTO';
import { PrismaService } from '@/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserLogin } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

@Injectable()
export class LoginService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async handleOAuthLogin(
    userPayload: IOAuthUserDTO,
  ): Promise<IOAuthLoginResponseDTO> {
    let userLogin: UserLogin | null = null;

    return this.prismaService.$transaction(async (transaction) => {
      userLogin = await transaction.userLogin.findUnique({
        where: {
          providerUserId: userPayload.id,
        },
      });

      if (!userLogin) {
        userLogin = await transaction.userLogin.create({
          data: {
            id: uuidv7(),
            providerUserId: userPayload.id,
            provider: userPayload.provider,
            status: 'active',
          },
        });
      }

      await transaction.user.upsert({
        where: {
          userLoginId: userLogin.id,
        },
        create: {
          id: uuidv7(),
          userLoginId: userLogin.id,
          gmail: userPayload.email,
          displayName: userPayload.displayName,
          pictureUrl: userPayload.picture,
        },
        update: {
          gmail: userPayload.email,
          displayName: userPayload.displayName,
          pictureUrl: userPayload.picture,
        },
      });

      const accessToken = await this.jwtService.signAsync({
        userLoginId: userLogin.id,
      });

      return {
        accessToken: accessToken,
        refreshToken: 'refreshToken',
      };
    });
  }
}
