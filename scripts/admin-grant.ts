/**
 * Grant (or revoke) the admin role for an existing account, by its Google email.
 *
 *   npm run admin:grant -- someone@example.com
 *   npm run admin:grant -- someone@example.com --revoke
 *
 * The account must have signed in once so its row exists. The change reaches the
 * access token at the next refresh (at most one access-token lifetime); the
 * cached profile is invalidated here so the UI reflects it straight away.
 */
import { config as loadDotenv } from 'dotenv';
import { ADMIN_ROLE } from '@/auth/roles';
import { CacheService } from '@/cache/cache.service';
import { PrismaService } from '@/prisma/prisma.service';

loadDotenv({ quiet: true });

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const revoke = args.includes('--revoke');
    const email = args.find((arg) => !arg.startsWith('--'));
    if (!email) {
        console.error('Usage: npm run admin:grant -- <email> [--revoke]');
        process.exitCode = 1;
        return;
    }

    const prisma = new PrismaService();
    const cache = new CacheService({
        get: (key: string) =>
            key === 'redis.url' ? process.env.REDIS_URL : undefined,
    } as never);

    try {
        await prisma.$connect();
        const user = await prisma.user.findFirst({
            where: { gmail: { equals: email.trim(), mode: 'insensitive' } },
            include: { userLogin: { select: { id: true, roles: true } } },
        });
        if (!user) {
            console.error(
                `No account with email ${email}. Sign in once first, then retry.`,
            );
            process.exitCode = 1;
            return;
        }

        const current = user.userLogin.roles ?? [];
        const roles = revoke
            ? current.filter((role) => role !== ADMIN_ROLE)
            : Array.from(new Set([...current, ADMIN_ROLE]));

        await prisma.userLogin.update({
            where: { id: user.userLogin.id },
            data: { roles },
        });

        await cache.onModuleInit();
        await cache.invalidateUser(user.userLogin.id);
        await cache.onModuleDestroy();

        console.log(
            `${email}: roles = [${roles.join(', ')}] (userLoginId ${user.userLogin.id})`,
        );
    } finally {
        await prisma.onModuleDestroy();
    }
}

void main();
