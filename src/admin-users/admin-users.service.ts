import {
    AdminUserDetail,
    AdminUserList,
    AdminUserStats,
    AdminUserSummary,
    ListUsersQueryDto,
    UserStatsQueryDto,
} from '@/admin-users/dto/admin-users.dto';
import {
    type AssignableRole,
    fillDailySeries,
    nextRoles,
    parseIsoDate,
    addDays,
    refuseAccountChange,
    resolveRange,
    toPaging,
} from '@/admin-users/admin-users.logic';
import {
    ACTIVE_USER_LOGIN_STATUS,
    type UserLoginStatus,
} from '@/auth/user-login-status';
import { ADMIN_ROLE, parseAdminEmails } from '@/auth/roles';
import { CacheService } from '@/cache/cache.service';
import { PrismaService } from '@/prisma/prisma.service';
import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/** A `UserLogin` with what the admin views need, as one Prisma include. */
const loginInclude = (now: Date) =>
    ({
        users: {
            select: { gmail: true, displayName: true, pictureUrl: true },
            take: 1,
        },
        _count: {
            select: {
                refreshToken: {
                    where: { rotatedAt: null, expiresAt: { gt: now } },
                },
            },
        },
    }) satisfies Prisma.UserLoginInclude;

type LoginRow = Prisma.UserLoginGetPayload<{
    include: ReturnType<typeof loginInclude>;
}>;

/**
 * Account administration behind `/admin/users`: find accounts, grant or revoke
 * admin, suspend, and end sessions.
 *
 * Every write re-reads the target inside a serializable transaction, so the
 * "last active admin" rail holds even when two admins demote each other at the
 * same moment, and ends with the cached profile invalidated so `/profile`
 * shows the change at once. Roles reach the target's access token at its next
 * refresh; a suspension also deletes the refresh tokens, so the account is out
 * within one access-token lifetime.
 */
@Injectable()
export class AdminUsersService {
    private readonly logger = new Logger(AdminUsersService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: CacheService,
        private readonly config: ConfigService,
    ) {}

    async list(query: ListUsersQueryDto): Promise<AdminUserList> {
        const paging = toPaging(query.page, query.pageSize);
        const q = query.q?.trim();
        const where: Prisma.UserLoginWhereInput = {
            ...(query.role ? { roles: { has: query.role } } : {}),
            ...(query.status ? { status: query.status } : {}),
            ...(q
                ? {
                      users: {
                          some: {
                              OR: [
                                  {
                                      gmail: {
                                          contains: q,
                                          mode: 'insensitive',
                                      },
                                  },
                                  {
                                      displayName: {
                                          contains: q,
                                          mode: 'insensitive',
                                      },
                                  },
                              ],
                          },
                      },
                  }
                : {}),
        };

        const now = new Date();
        const [rows, total] = await Promise.all([
            this.prisma.userLogin.findMany({
                where,
                include: loginInclude(now),
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                skip: paging.skip,
                take: paging.pageSize,
            }),
            this.prisma.userLogin.count({ where }),
        ]);

        return {
            items: rows.map((row) => this.toSummary(row)),
            total,
            page: paging.page,
            pageSize: paging.pageSize,
        };
    }

    async detail(userLoginId: string): Promise<AdminUserDetail> {
        const row = await this.prisma.userLogin.findUnique({
            where: { id: userLoginId },
            include: loginInclude(new Date()),
        });
        if (!row) throw new NotFoundException('User not found');

        const lastToken = await this.prisma.refreshToken.findFirst({
            where: { userLoginId },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
        });

        return {
            ...this.toSummary(row),
            updatedAt: row.updatedAt.toISOString(),
            lastSeenAt: lastToken?.createdAt.toISOString() ?? null,
        };
    }

    async stats(query: UserStatsQueryDto): Promise<AdminUserStats> {
        const range = resolveRange(query.from, query.to);
        if (typeof range === 'string') throw new BadRequestException(range);

        const start = parseIsoDate(range.from);
        const endExclusive = addDays(parseIsoDate(range.to), 1);

        const [users, admins, suspended, perDay] = await Promise.all([
            this.prisma.userLogin.count(),
            this.prisma.userLogin.count({
                where: {
                    roles: { has: ADMIN_ROLE },
                    status: ACTIVE_USER_LOGIN_STATUS,
                },
            }),
            this.prisma.userLogin.count({
                where: { status: { not: ACTIVE_USER_LOGIN_STATUS } },
            }),
            this.prisma.$queryRaw<{ date: string; count: number }[]>`
                SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
                       count(*)::int AS count
                FROM user_logins
                WHERE created_at >= ${start} AND created_at < ${endExclusive}
                GROUP BY 1`,
        ]);

        const signups = fillDailySeries(range, perDay);
        return {
            ...range,
            totals: { users, admins, suspended },
            newUsers: signups.reduce((sum, day) => sum + day.count, 0),
            signups,
        };
    }

    async setRoles(
        actorId: string,
        targetId: string,
        requested: AssignableRole[],
    ): Promise<AdminUserDetail> {
        await this.write(actorId, targetId, 'set_roles', async (tx, target) => {
            const roles = nextRoles(target.roles, requested);
            this.assertAllowed(actorId, target, {
                removesAdmin: !roles.includes(ADMIN_ROLE),
                admins: await this.countActiveAdmins(tx),
            });
            await tx.userLogin.update({
                where: { id: targetId },
                data: { roles },
            });
            return { roles };
        });
        return this.detail(targetId);
    }

    async setStatus(
        actorId: string,
        targetId: string,
        status: UserLoginStatus,
    ): Promise<AdminUserDetail> {
        await this.write(
            actorId,
            targetId,
            'set_status',
            async (tx, target) => {
                this.assertAllowed(actorId, target, {
                    removesAdmin: status !== ACTIVE_USER_LOGIN_STATUS,
                    admins: await this.countActiveAdmins(tx),
                });
                await tx.userLogin.update({
                    where: { id: targetId },
                    data: { status },
                });
                // Locked out of refresh by `assertActive` already; dropping the
                // tokens as well means no device keeps a session to come back to.
                const ended =
                    status === ACTIVE_USER_LOGIN_STATUS
                        ? 0
                        : (
                              await tx.refreshToken.deleteMany({
                                  where: { userLoginId: targetId },
                              })
                          ).count;
                return { status, sessionsEnded: ended };
            },
        );
        return this.detail(targetId);
    }

    async revokeSessions(
        actorId: string,
        targetId: string,
    ): Promise<{ sessionsEnded: number }> {
        const result = await this.write(
            actorId,
            targetId,
            'revoke_sessions',
            async (tx) => {
                const { count } = await tx.refreshToken.deleteMany({
                    where: { userLoginId: targetId },
                });
                return { sessionsEnded: count };
            },
        );
        return { sessionsEnded: result.sessionsEnded };
    }

    /**
     * Run one admin write on an existing account: serializable, followed by a
     * cache invalidation and an `admin_action` log line naming who did what.
     */
    private async write<T extends Record<string, unknown>>(
        actorId: string,
        targetId: string,
        action: string,
        change: (
            tx: Tx,
            target: { id: string; roles: string[]; status: string },
        ) => Promise<T>,
    ): Promise<T> {
        let result: T;
        try {
            result = await this.prisma.$transaction(
                async (tx) => {
                    const target = await tx.userLogin.findUnique({
                        where: { id: targetId },
                        select: { id: true, roles: true, status: true },
                    });
                    if (!target) throw new NotFoundException('User not found');
                    return change(tx, target);
                },
                {
                    isolationLevel:
                        Prisma.TransactionIsolationLevel.Serializable,
                },
            );
        } catch (error) {
            if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2034'
            ) {
                throw new ConflictException(
                    'Another change to this account happened at the same time; try again',
                );
            }
            throw error;
        }

        await this.cache.invalidateUser(targetId);
        this.logger.log(
            `admin_action ${JSON.stringify({ actor: actorId, action, target: targetId, ...result })}`,
        );
        return result;
    }

    private assertAllowed(
        actorId: string,
        target: { id: string; roles: string[]; status: string },
        change: { removesAdmin: boolean; admins: number },
    ): void {
        const refusal = refuseAccountChange({
            actorId,
            targetId: target.id,
            targetIsActiveAdmin:
                target.roles.includes(ADMIN_ROLE) &&
                target.status === ACTIVE_USER_LOGIN_STATUS,
            removesAdmin: change.removesAdmin,
            activeAdminCount: change.admins,
        });
        if (refusal) throw new ConflictException(refusal);
    }

    private countActiveAdmins(tx: Tx): Promise<number> {
        return tx.userLogin.count({
            where: {
                roles: { has: ADMIN_ROLE },
                status: ACTIVE_USER_LOGIN_STATUS,
            },
        });
    }

    private toSummary(row: LoginRow): AdminUserSummary {
        const profile = row.users[0];
        const email = profile?.gmail ?? null;
        return {
            userLoginId: row.id,
            email,
            displayName: profile?.displayName ?? null,
            pictureUrl: profile?.pictureUrl ?? null,
            provider: row.provider,
            status: row.status,
            roles: row.roles ?? [],
            bootstrapAdmin:
                email !== null && this.adminEmails().has(email.toLowerCase()),
            activeSessions: row._count.refreshToken,
            createdAt: row.createdAt.toISOString(),
        };
    }

    private adminEmails(): Set<string> {
        return parseAdminEmails(this.config.get<string>('adminEmails'));
    }
}
