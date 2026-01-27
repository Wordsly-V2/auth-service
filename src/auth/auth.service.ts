import {
  IOAuthLoginResponseDTO,
  IOAuthUserDTO,
  JwtAuthPayload,
} from '@/auth/DTO/auth.dto';
import { PrismaService } from '@/prisma/prisma.service';
import { Injectable, UnauthorizedException } from '@nestjs/common';
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
    userIpAddress: string | undefined,
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

      const { accessToken, refreshToken, refreshTokenJti } =
        await this.generateJwtToken(userLogin.id);

      await transaction.refreshToken.create({
        data: {
          id: uuidv7(),
          userLoginId: userLogin.id,
          token: refreshToken,
          jwtId: refreshTokenJti,
          allocatedIp: userIpAddress ?? null,
        },
      });

      return {
        accessToken,
        refreshToken,
      };
    });
  }

  async handleRefreshToken({
    jwtPayload,
    userIpAddress,
  }: {
    jwtPayload: JwtAuthPayload;
    userIpAddress: string | undefined;
  }): Promise<IOAuthLoginResponseDTO> {
    return this.prismaService.$transaction(async (transaction) => {
      const dbRefreshToken = await transaction.refreshToken.findUnique({
        where: {
          jwtId: jwtPayload.jti,
        },
      });

      if (!dbRefreshToken) {
        throw new UnauthorizedException('Refresh token not found');
      }

      if (dbRefreshToken.allocatedIp !== userIpAddress) {
        console.log(
          'Refresh token allocated IP does not match user IP address',
          {
            jti: dbRefreshToken.jwtId,
            allocatedIp: dbRefreshToken.allocatedIp,
            userIpAddress,
          },
        );

        // revoke all refresh tokens for the user
        await transaction.refreshToken.deleteMany({
          where: {
            userLoginId: dbRefreshToken.userLoginId,
          },
        });

        throw new UnauthorizedException('Unauthorized');
      }

      const { accessToken, refreshToken, refreshTokenJti } =
        await this.generateJwtToken(jwtPayload.userLoginId);

      await Promise.all([
        transaction.refreshToken.delete({
          where: {
            id: dbRefreshToken.id,
          },
        }),
        transaction.refreshToken.create({
          data: {
            id: uuidv7(),
            userLoginId: jwtPayload.userLoginId,
            token: refreshToken,
            jwtId: refreshTokenJti,
            allocatedIp: userIpAddress ?? null,
          },
        }),
      ]);

      return {
        accessToken,
        refreshToken,
      };
    });
  }

  async generateJwtToken(userLoginId: string): Promise<{
    accessToken: string;
    accessTokenJti: string;
    refreshToken: string;
    refreshTokenJti: string;
  }> {
    const accessTokenJti = uuidv7();
    const accessToken = await this.jwtService.signAsync<JwtAuthPayload>({
      userLoginId: userLoginId,
      jti: accessTokenJti,
    });

    const refreshTokenJti = uuidv7();
    const refreshToken = await this.jwtService.signAsync<JwtAuthPayload>(
      {
        userLoginId: userLoginId,
        jti: refreshTokenJti,
      },
      {
        expiresIn: this.configService.get(
          'jwt.refreshTokenExpiresIn',
        ) as JwtSignOptions['expiresIn'],
      },
    );

    return {
      accessToken,
      accessTokenJti,
      refreshToken,
      refreshTokenJti,
    };
  }
}
