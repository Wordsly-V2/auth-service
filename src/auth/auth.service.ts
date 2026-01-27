import {
  IOAuthLoginResponseDTO,
  IOAuthUserDTO,
  JwtAuthPayload,
} from '@/auth/DTO/auth.dto';
import { PrismaService } from '@/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { UserLogin } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
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

      const accessToken = await this.jwtService.signAsync<JwtAuthPayload>({
        userLoginId: userLogin.id,
        jti: uuidv7(),
      });

      const refreshTokenJwtId = uuidv7();
      const refreshTokenJwt = await this.jwtService.signAsync<JwtAuthPayload>(
        {
          userLoginId: userLogin.id,
          jti: refreshTokenJwtId,
        },
        {
          expiresIn: this.configService.get(
            'jwt.refreshTokenExpiresIn',
          ) as JwtSignOptions['expiresIn'],
        },
      );

      await transaction.refreshToken.create({
        data: {
          userLoginId: userLogin.id,
          token: refreshTokenJwt,
          jwtId: refreshTokenJwtId,
        },
      });

      return {
        accessToken,
        refreshToken: refreshTokenJwt,
      };
    });
  }
}
