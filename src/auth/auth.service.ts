import {
  IOAuthLoginResponseDTO,
  IOAuthUserDTO,
  JwtAuthPayload,
} from '@/auth/dto/auth.dto';
import { CacheService } from '@/cache/cache.service';
import { PrismaService } from '@/prisma/prisma.service';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Prisma, UserLogin } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import ms from 'ms';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
  ) {}

  async handleOAuthLogin(
    userPayload: IOAuthUserDTO,
    userIpAddress: string | undefined,
  ): Promise<IOAuthLoginResponseDTO> {
    let userLogin: UserLogin | null = null;

    const result = await this.prismaService.$transaction(async (transaction) => {
      try {
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

        const { accessToken, refreshToken, tokenJti } =
          await this.generateJwtToken(userLogin.id);

        await transaction.refreshToken.create({
          data: {
            id: uuidv7(),
            userLoginId: userLogin.id,
            token: refreshToken,
            jwtId: tokenJti,
            allocatedIp: userIpAddress ?? null,
            expiresAt: this.getRefreshTokenExpiresAt(),
          },
        });

        return {
          accessToken,
          refreshToken,
        };
      } catch (error) {
        this.logger.error('OAuth login transaction failed', error as Error);
        throw error;
      }
    });

    await this.cacheService.invalidateUser(userLogin!.id);

    return result;
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
        // A valid signature over a jti we already rotated away means this token
        // was replayed — either the client resent a spent token, or an attacker
        // is using a copy the victim already refreshed past. That is the real
        // theft signal (unlike a changed IP, which is just a network handover),
        // so burn the whole family and force a fresh login.
        this.logger.warn('Refresh token reuse detected', {
          jti: jwtPayload.jti,
          userLoginId: jwtPayload.userLoginId,
        });

        await transaction.refreshToken.deleteMany({
          where: {
            userLoginId: jwtPayload.userLoginId,
          },
        });

        throw new UnauthorizedException('Refresh token not found');
      }

      if (dbRefreshToken.allocatedIp !== userIpAddress) {
        // Rotate and warn, never revoke. A changed IP is overwhelmingly a
        // legitimate network handover (cell <-> wifi, new DHCP lease, CGNAT
        // egress change) — exactly what happens when a client comes back from
        // being offline and flushes its queued practice. Revoking here stranded
        // that sync behind an interactive login on every device. Theft is
        // caught by the reuse check above instead; rotation below is unchanged,
        // so refresh tokens remain single-use.
        this.logger.warn(
          'Refresh token allocated IP does not match user IP address',
          {
            jti: dbRefreshToken.jwtId,
            allocatedIp: dbRefreshToken.allocatedIp,
            userIpAddress,
          },
        );
      }

      const { accessToken, refreshToken, tokenJti } =
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
            jwtId: tokenJti,
            allocatedIp: userIpAddress ?? null,
            expiresAt: this.getRefreshTokenExpiresAt(),
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
    refreshToken: string;
    tokenJti: string;
  }> {
    const tokenJti = uuidv7();
    const accessToken = await this.jwtService.signAsync<JwtAuthPayload>({
      userLoginId: userLoginId,
      jti: tokenJti,
    });

    const refreshToken = await this.jwtService.signAsync<JwtAuthPayload>(
      {
        userLoginId: userLoginId,
        jti: tokenJti,
      },
      {
        expiresIn: this.configService.get(
          'jwt.refreshTokenExpiresIn',
        ) as JwtSignOptions['expiresIn'],
      },
    );

    return {
      accessToken,
      refreshToken,
      tokenJti,
    };
  }

  private getRefreshTokenExpiresAt(): Date {
    const expiresIn = this.configService.get(
      'jwt.refreshTokenExpiresIn',
    ) as JwtSignOptions['expiresIn'];
    const ttlMs =
      typeof expiresIn === 'number'
        ? expiresIn * 1000
        : ms(expiresIn as unknown as ms.StringValue);
    if (ttlMs === undefined || Number.isNaN(ttlMs)) {
      throw new Error('Invalid jwt.refreshTokenExpiresIn configuration');
    }
    return new Date(Date.now() + ttlMs);
  }

  async handleLogout(
    user: JwtAuthPayload,
    isLoggedOutFromAllDevices: boolean = false,
  ): Promise<{ success: boolean }> {
    try {
      if (isLoggedOutFromAllDevices) {
        await this.prismaService.refreshToken.deleteMany({
          where: { userLoginId: user.userLoginId },
        });
      } else {
        await this.prismaService.refreshToken.delete({
          where: { jwtId: user.jti, userLoginId: user.userLoginId },
        });
      }

      return { success: true };
    } catch (error) {
      if ((error as Prisma.PrismaClientKnownRequestError).code === 'P2025') {
        return { success: true };
      }
      throw error;
    }
  }
}
