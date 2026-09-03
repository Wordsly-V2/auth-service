import {
    IOAuthLoginResponseDTO,
    IOAuthUserDTO,
    JwtAuthPayload,
} from '@/auth/dto/auth.dto';
import { CacheService } from '@/cache/cache.service';
import { PrismaService } from '@/prisma/prisma.service';
import { TokenService } from '@/auth/token.service';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Prisma, UserLogin } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import { ConfigService } from '@nestjs/config';
import ms from 'ms';

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        private readonly prismaService: PrismaService,
        private readonly tokenService: TokenService,
        private readonly configService: ConfigService,
        private readonly cacheService: CacheService,
    ) {}

    async handleOAuthLogin(
        userPayload: IOAuthUserDTO,
        userIpAddress: string | undefined,
    ): Promise<IOAuthLoginResponseDTO> {
        let userLogin: UserLogin | null = null;

        const result = await this.prismaService.$transaction(
            async (transaction) => {
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

                    // A fresh login starts a new session.
                    const { accessToken, refreshToken, refreshJti, sid } =
                        await this.generateJwtToken(userLogin.id, uuidv7());

                    await transaction.refreshToken.create({
                        data: {
                            id: uuidv7(),
                            userLoginId: userLogin.id,
                            token: refreshToken,
                            jwtId: refreshJti,
                            sessionId: sid,
                            allocatedIp: userIpAddress ?? null,
                            expiresAt: this.getRefreshTokenExpiresAt(),
                        },
                    });

                    return {
                        accessToken,
                        refreshToken,
                    };
                } catch (error) {
                    this.logger.error(
                        'OAuth login transaction failed',
                        error as Error,
                    );
                    throw error;
                }
            },
        );

        await this.cacheService.invalidateUser(userLogin!.id);

        return result;
    }

    /**
     * Rotate a refresh token.
     *
     * The signature is verified *here*, from the raw token. This endpoint used to
     * accept an already-decoded payload from the caller and mint tokens for
     * whatever `userLoginId` it named, which made it a token-minting oracle for
     * anyone who could reach it. Verifying in the service that owns the keys means
     * no caller can be trusted into that position again.
     */
    async handleRefreshToken({
        refreshToken: presentedToken,
        userIpAddress,
    }: {
        refreshToken: string;
        userIpAddress: string | undefined;
    }): Promise<IOAuthLoginResponseDTO> {
        const jwtPayload: JwtAuthPayload = await this.tokenService.verify(
            presentedToken,
            'refresh',
        );

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
                    userLoginId: jwtPayload.sub,
                });

                await transaction.refreshToken.deleteMany({
                    where: {
                        userLoginId: jwtPayload.sub,
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

            // Rotation replaces the tokens but not the session: the device is the
            // same one, so logging it out later must still be able to find this row.
            const { accessToken, refreshToken, refreshJti, sid } =
                await this.generateJwtToken(
                    dbRefreshToken.userLoginId,
                    dbRefreshToken.sessionId,
                );

            await Promise.all([
                transaction.refreshToken.delete({
                    where: {
                        id: dbRefreshToken.id,
                    },
                }),
                transaction.refreshToken.create({
                    data: {
                        id: uuidv7(),
                        userLoginId: dbRefreshToken.userLoginId,
                        token: refreshToken,
                        jwtId: refreshJti,
                        sessionId: sid,
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

    /**
     * Mint an access/refresh pair for a session.
     *
     * The two tokens get *separate* `jti`s. They used to share one, which meant a
     * refresh token was a structurally valid access token with a 30-day life.
     */
    async generateJwtToken(userLoginId: string, sid: string) {
        return this.tokenService.issueTokens({
            userLoginId,
            sid,
            accessJti: uuidv7(),
            refreshJti: uuidv7(),
        });
    }

    private getRefreshTokenExpiresAt(): Date {
        const expiresIn = this.configService.get<string | number>(
            'jwt.refreshTokenExpiresIn',
        );
        const ttlMs =
            typeof expiresIn === 'number'
                ? expiresIn * 1000
                : ms(expiresIn as ms.StringValue);
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
                    where: { userLoginId: user.sub },
                });
            } else if (user.sid) {
                // Keyed on the session rather than the token id: the access token the
                // caller logged out with no longer shares a `jti` with its refresh
                // token, and `sid` is the only thing linking the two.
                await this.prismaService.refreshToken.deleteMany({
                    where: { sessionId: user.sid, userLoginId: user.sub },
                });
            } else {
                // A token minted before sessions existed names no device to end. Ending
                // every session is the safe reading of "log me out": erring towards
                // revoking too much beats leaving the user signed in after they asked
                // not to be.
                this.logger.warn(
                    'Logout with no session id; revoking every session for the user',
                    { userLoginId: user.sub },
                );
                await this.prismaService.refreshToken.deleteMany({
                    where: { userLoginId: user.sub },
                });
            }

            return { success: true };
        } catch (error) {
            if (
                (error as Prisma.PrismaClientKnownRequestError).code === 'P2025'
            ) {
                return { success: true };
            }
            throw error;
        }
    }
}
