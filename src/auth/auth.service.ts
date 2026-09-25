import {
    IOAuthLoginResponseDTO,
    IOAuthUserDTO,
    JwtAuthPayload,
} from '@/auth/dto/auth.dto';
import { CacheService } from '@/cache/cache.service';
import { PrismaService } from '@/prisma/prisma.service';
import { hashRefreshToken } from '@/auth/refresh-token-hash';
import { TokenService } from '@/auth/token.service';
import { bootstrapRoles, parseAdminEmails } from '@/auth/roles';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Prisma, UserLogin } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import { ConfigService } from '@nestjs/config';
import ms from 'ms';

/**
 * How long a rotated refresh token may still be presented. Long enough to cover
 * tabs refreshing together and a retry after a lost response on a slow mobile
 * link; short enough that a stolen copy is almost always caught as reuse.
 */
export const REFRESH_REUSE_GRACE_MS = 30_000;

/** The only `UserLogin.status` that may sign in; anything else is locked out. */
export const ACTIVE_USER_LOGIN_STATUS = 'active';

function assertActive(userLogin: Pick<UserLogin, 'status'>): void {
    if (userLogin.status !== ACTIVE_USER_LOGIN_STATUS) {
        throw new UnauthorizedException('Account is not active');
    }
}

type RefreshOutcome =
    | { kind: 'rotated'; tokens: IOAuthLoginResponseDTO }
    | { kind: 'reused' };

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
        // Another user whose stale copy of this email was cleared; their cached
        // profile has to go too.
        let displacedUserLoginId: string | null = null;

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
                                status: ACTIVE_USER_LOGIN_STATUS,
                            },
                        });
                    }

                    assertActive(userLogin);

                    const grantedRoles = bootstrapRoles(
                        userLogin.roles ?? [],
                        userPayload.email,
                        parseAdminEmails(
                            this.configService.get<string>('adminEmails'),
                        ),
                    );
                    if (grantedRoles) {
                        userLogin = await transaction.userLogin.update({
                            where: { id: userLogin.id },
                            data: { roles: grantedRoles },
                        });
                        this.logger.log(
                            'Granted admin role from ADMIN_EMAILS',
                            {
                                userLoginId: userLogin.id,
                            },
                        );
                    }

                    // `gmail` is unique, but identity is `providerUserId`: Google
                    // can hand an address to a different account (a deleted account's
                    // address recycled, a Workspace user renamed). The provider is the
                    // authority on who holds it *now*, so the stale copy is cleared
                    // rather than failing this login with P2002. It is profile data
                    // only -- nothing looks a user up by it -- so no account is linked
                    // or taken over by this.
                    if (userPayload.email) {
                        const holder = await transaction.user.findUnique({
                            where: { gmail: userPayload.email },
                            select: { id: true, userLoginId: true },
                        });
                        if (holder && holder.userLoginId !== userLogin.id) {
                            this.logger.warn(
                                'Email moved to another provider account; clearing it from the previous holder',
                                {
                                    userLoginId: userLogin.id,
                                    previousUserLoginId: holder.userLoginId,
                                },
                            );
                            await transaction.user.update({
                                where: { id: holder.id },
                                data: { gmail: null },
                            });
                            displacedUserLoginId = holder.userLoginId;
                        }
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
                        await this.generateJwtToken(
                            userLogin.id,
                            uuidv7(),
                            userLogin.roles ?? [],
                        );

                    await transaction.refreshToken.create({
                        data: {
                            id: uuidv7(),
                            userLoginId: userLogin.id,
                            tokenHash: hashRefreshToken(refreshToken),
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
        if (displacedUserLoginId) {
            await this.cacheService.invalidateUser(displacedUserLoginId);
        }

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

        const now = new Date();
        const outcome = await this.prismaService.$transaction(
            async (transaction): Promise<RefreshOutcome> => {
                const dbRefreshToken =
                    await transaction.refreshToken.findUnique({
                        where: {
                            jwtId: jwtPayload.jti,
                        },
                        include: {
                            userLogin: {
                                select: { status: true, roles: true },
                            },
                        },
                    });

                // A valid signature over a jti we no longer hold, or one rotated
                // away longer ago than the grace window, means this token was
                // replayed — the client resent a long-spent token, or an attacker
                // is using a copy the victim already refreshed past. That is the
                // real theft signal (unlike a changed IP, which is just a network
                // handover). Revocation happens after this transaction: throwing
                // in here would roll the revocation back with everything else.
                if (
                    !dbRefreshToken ||
                    (dbRefreshToken.rotatedAt &&
                        now.getTime() - dbRefreshToken.rotatedAt.getTime() >
                            REFRESH_REUSE_GRACE_MS)
                ) {
                    return { kind: 'reused' };
                }

                // Checked on every refresh, not just at login: a refresh token
                // outlives the access token by weeks, so this is where a suspended
                // account actually gets locked out. Thrown before the row is
                // claimed, so the rollback leaves nothing half-rotated.
                assertActive(dbRefreshToken.userLogin);

                if (dbRefreshToken.allocatedIp !== userIpAddress) {
                    // Rotate and warn, never revoke. A changed IP is overwhelmingly a
                    // legitimate network handover (cell <-> wifi, new DHCP lease, CGNAT
                    // egress change) — exactly what happens when a client comes back from
                    // being offline and flushes its queued practice. Revoking here stranded
                    // that sync behind an interactive login on every device. Theft is
                    // caught by the reuse check above instead.
                    this.logger.warn(
                        'Refresh token allocated IP does not match user IP address',
                        {
                            jti: dbRefreshToken.jwtId,
                            allocatedIp: dbRefreshToken.allocatedIp,
                            userIpAddress,
                        },
                    );
                }

                // Claim the row with a conditional update rather than trusting the
                // read above: two concurrent refreshes of one token both see it
                // unrotated, and only one of them may win the normal rotation.
                const claimed =
                    dbRefreshToken.rotatedAt === null &&
                    (
                        await transaction.refreshToken.updateMany({
                            where: { id: dbRefreshToken.id, rotatedAt: null },
                            data: { rotatedAt: now },
                        })
                    ).count === 1;

                if (!claimed) {
                    // Rotated moments ago: another tab refreshing at the same time,
                    // or a retry after the response carrying the new pair was lost.
                    // Answer with a fresh pair instead of treating it as theft, and
                    // retire whatever the other refresh issued so the session still
                    // has exactly one live refresh token.
                    this.logger.log(
                        'Refresh token reused within grace window',
                        {
                            jti: dbRefreshToken.jwtId,
                            sessionId: dbRefreshToken.sessionId,
                        },
                    );
                    await transaction.refreshToken.updateMany({
                        where: {
                            sessionId: dbRefreshToken.sessionId,
                            rotatedAt: null,
                        },
                        data: { rotatedAt: now },
                    });
                }

                // Rotation replaces the tokens but not the session: the device is the
                // same one, so logging it out later must still be able to find this row.
                // Roles are re-read here rather than copied from the old token, so a
                // grant or revocation takes effect at the next refresh.
                const { accessToken, refreshToken, refreshJti, sid } =
                    await this.generateJwtToken(
                        dbRefreshToken.userLoginId,
                        dbRefreshToken.sessionId,
                        dbRefreshToken.userLogin.roles ?? [],
                    );

                await Promise.all([
                    // Rotated rows only need to outlive the grace window; past it, a
                    // missing row reads as reuse just the same.
                    transaction.refreshToken.deleteMany({
                        where: {
                            sessionId: dbRefreshToken.sessionId,
                            rotatedAt: {
                                lt: new Date(
                                    now.getTime() - REFRESH_REUSE_GRACE_MS,
                                ),
                            },
                        },
                    }),
                    transaction.refreshToken.create({
                        data: {
                            id: uuidv7(),
                            userLoginId: dbRefreshToken.userLoginId,
                            tokenHash: hashRefreshToken(refreshToken),
                            jwtId: refreshJti,
                            sessionId: sid,
                            allocatedIp: userIpAddress ?? null,
                            expiresAt: this.getRefreshTokenExpiresAt(),
                        },
                    }),
                ]);

                return {
                    kind: 'rotated',
                    tokens: { accessToken, refreshToken },
                };
            },
        );

        if (outcome.kind === 'reused') {
            this.logger.warn('Refresh token reuse detected', {
                jti: jwtPayload.jti,
                userLoginId: jwtPayload.sub,
            });
            // Burn every session for the user and force a fresh login.
            await this.prismaService.refreshToken.deleteMany({
                where: {
                    userLoginId: jwtPayload.sub,
                },
            });
            throw new UnauthorizedException('Refresh token not found');
        }

        return outcome.tokens;
    }

    /**
     * Mint an access/refresh pair for a session.
     *
     * The two tokens get *separate* `jti`s. They used to share one, which meant a
     * refresh token was a structurally valid access token with a 30-day life.
     */
    async generateJwtToken(
        userLoginId: string,
        sid: string,
        roles: readonly string[],
    ) {
        return this.tokenService.issueTokens({
            userLoginId,
            sid,
            accessJti: uuidv7(),
            refreshJti: uuidv7(),
            roles,
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
