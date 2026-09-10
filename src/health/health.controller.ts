import { Controller, Get } from '@nestjs/common';
import {
    HealthCheck,
    HealthCheckService,
    HealthIndicatorService,
    type HealthIndicatorResult,
} from '@nestjs/terminus';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import { Public } from '@/common/decorators/public.decorator';

/** A probe must never be the thing that hangs. */
const DEPENDENCY_TIMEOUT_MS = 3_000;
/** Shared across concurrent probes so a tight polling loop cannot amplify load. */
const CACHE_MS = 2_000;

/**
 * Liveness and readiness, which are different questions.
 *
 * `/health` answers "is this process alive" and touches nothing: an orchestrator
 * uses it to decide whether to restart the container, so a failing database must
 * not make it restart a perfectly healthy process in a loop.
 *
 * `/ready` answers "can this process serve traffic" and checks the dependencies.
 * Both endpoints used to return the same hardcoded string, which meant `/health`
 * reported 200 with Postgres down and nothing could act on it.
 *
 * Redis reports `degraded` rather than `down`: the cache layer already falls
 * back to the database when it cannot connect, so losing it is slower, not
 * broken, and must not pull the service out of the load balancer.
 */
@Controller()
export class HealthController {
    constructor(
        private readonly healthCheck: HealthCheckService,
        private readonly health: HealthIndicatorService,
        private readonly prisma: PrismaService,
        private readonly cache: CacheService,
    ) {}

    /** Liveness. Deliberately checks nothing. */
    @Public()
    @Get('health')
    live() {
        return { status: 'ok' };
    }

    /** Readiness. 503 when a hard dependency is unreachable. */
    @Public()
    @Get('ready')
    @HealthCheck()
    ready() {
        return this.healthCheck.check([
            () =>
                this.health
                    .check('database')
                    .attempt(async () => {
                        await this.prisma.$queryRaw`SELECT 1`;
                    })
                    .withTimeout(DEPENDENCY_TIMEOUT_MS)
                    .cacheFor(CACHE_MS),
            () => this.redisHealth(),
        ]);
    }

    /**
     * Redis, reported as `degraded` rather than `down` in every failure mode.
     *
     * CacheService already falls back to the database when it cannot reach
     * Redis, so an outage here makes the service slower, not incorrect —
     * failing readiness would pull a still-serving instance out of rotation.
     */
    private async redisHealth(): Promise<HealthIndicatorResult> {
        const session = this.health.check('redis');
        const unavailable = 'cache unavailable, serving from database';

        if (!this.cache.isEnabled) {
            return session.degraded({ message: 'cache disabled' });
        }

        try {
            const timeout = new Promise<never>((_, reject) =>
                setTimeout(
                    () => reject(new Error('timed out')),
                    DEPENDENCY_TIMEOUT_MS,
                ).unref(),
            );
            const ok = await Promise.race([this.cache.ping(), timeout]);
            return ok
                ? session.up()
                : session.degraded({ message: unavailable });
        } catch {
            return session.degraded({ message: unavailable });
        }
    }
}
