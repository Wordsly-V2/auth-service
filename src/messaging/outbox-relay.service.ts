import { KafkaProducerService } from '@/messaging/kafka-producer.service';
import { PrismaService } from '@/prisma/prisma.service';
import {
    Injectable,
    Logger,
    OnApplicationBootstrap,
    OnModuleDestroy,
} from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';

/** Rows claimed per round. */
export const OUTBOX_BATCH_SIZE = 50;
/** How long a claim keeps other instances off a row (a crashed relay's rows come back after it). */
export const OUTBOX_LEASE_SECONDS = 60;
/** Published rows are kept this long, for tracing, then swept. */
export const OUTBOX_RETENTION_DAYS = 7;

const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;

/** Wait before the next try after `failures` failed sends: 5s, 10s, 20s… capped at 5 min. */
export function outboxBackoffMs(failures: number): number {
    return Math.min(
        BASE_BACKOFF_MS * 2 ** Math.max(0, failures - 1),
        MAX_BACKOFF_MS,
    );
}

interface ClaimedRow {
    id: string;
    topic: string;
    key: string | null;
    payload: unknown;
    attempts: number;
    created_at: Date;
}

/**
 * Publishes the outbox to Kafka: every 5 seconds, and right after a write
 * (`kick`). Rows are claimed with `FOR UPDATE SKIP LOCKED` and a lease, so
 * several instances can run side by side without sending a row twice in the
 * normal case. Delivery is still at least once (a crash between the send and
 * the `published_at` update re-sends after the lease), so consumers must be
 * idempotent.
 *
 * A failed send backs that row off (`outboxBackoffMs`) and ends the round, so
 * a broker that is down costs one failed connect per round, not one per row.
 * Without `KAFKA_BROKERS` nothing runs and rows simply wait.
 */
@Injectable()
export class OutboxRelayService
    implements OnApplicationBootstrap, OnModuleDestroy
{
    private readonly logger = new Logger(OutboxRelayService.name);
    private running: Promise<void> | null = null;
    private again = false;
    private stopped = false;

    constructor(
        private readonly prisma: PrismaService,
        private readonly producer: KafkaProducerService,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        if (this.producer.enabled) {
            void this.kick();
            return;
        }
        const pending = await this.pendingCount().catch(() => 0);
        if (pending > 0) {
            this.logger.warn(
                `${pending} outbox message(s) wait for Kafka, which is not configured (KAFKA_BROKERS)`,
            );
        }
    }

    onModuleDestroy(): void {
        this.stopped = true;
    }

    @Interval(5_000)
    tick(): void {
        void this.kick();
    }

    /**
     * Publish what is due now. A call while a round is running asks for one
     * more round after it and shares its promise; never rejects.
     */
    kick(): Promise<void> {
        if (!this.producer.enabled || this.stopped) return Promise.resolve();
        if (this.running) {
            this.again = true;
            return this.running;
        }
        this.running = this.drain()
            .catch((error: unknown) => {
                this.logger.error(
                    `Outbox relay round failed: ${String(error)}`,
                );
            })
            .finally(() => {
                this.running = null;
            });
        return this.running;
    }

    /** Wait for the current round, at most `timeoutMs`. */
    async flush(timeoutMs: number): Promise<void> {
        let timer: NodeJS.Timeout | undefined;
        await Promise.race([
            this.kick(),
            new Promise<void>((resolve) => {
                timer = setTimeout(resolve, timeoutMs);
            }),
        ]);
        clearTimeout(timer);
    }

    async isPublished(id: string): Promise<boolean> {
        const row = await this.prisma.outboxMessage.findUnique({
            where: { id },
            select: { publishedAt: true },
        });
        return row?.publishedAt != null;
    }

    pendingCount(): Promise<number> {
        return this.prisma.outboxMessage.count({
            where: { publishedAt: null },
        });
    }

    @Cron(CronExpression.EVERY_DAY_AT_1AM)
    async sweepPublished(): Promise<void> {
        const before = new Date(
            Date.now() - OUTBOX_RETENTION_DAYS * 24 * 60 * 60_000,
        );
        const { count } = await this.prisma.outboxMessage.deleteMany({
            where: { publishedAt: { lt: before } },
        });
        if (count > 0) this.logger.log(`Swept ${count} published outbox rows`);
    }

    private async drain(): Promise<void> {
        do {
            this.again = false;
            const rows = await this.claim();
            const failed = await this.publish(rows);
            if (failed) return;
            if (rows.length === OUTBOX_BATCH_SIZE) this.again = true;
        } while (this.again && !this.stopped);
    }

    /** Lease up to a batch of due rows, oldest first. */
    private async claim(): Promise<ClaimedRow[]> {
        const rows = await this.prisma.$queryRaw<ClaimedRow[]>`
            UPDATE outbox_messages
            SET next_attempt_at = now() + make_interval(secs => ${OUTBOX_LEASE_SECONDS})
            WHERE id IN (
                SELECT id FROM outbox_messages
                WHERE published_at IS NULL AND next_attempt_at <= now()
                ORDER BY created_at
                LIMIT ${OUTBOX_BATCH_SIZE}
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, topic, key, payload, attempts, created_at`;
        return rows.sort(
            (a, b) => a.created_at.getTime() - b.created_at.getTime(),
        );
    }

    /** Send rows in order; returns true when one failed (the rest are released). */
    private async publish(rows: ClaimedRow[]): Promise<boolean> {
        for (const [index, row] of rows.entries()) {
            try {
                await this.producer.send(row.topic, [
                    { key: row.key, value: JSON.stringify(row.payload) },
                ]);
            } catch (error) {
                const failures = row.attempts + 1;
                const retryAt = new Date(
                    Date.now() + outboxBackoffMs(failures),
                );
                await this.prisma.outboxMessage.update({
                    where: { id: row.id },
                    data: {
                        attempts: failures,
                        lastError: String(error).slice(0, 1000),
                        nextAttemptAt: retryAt,
                    },
                });
                // Not tried, so not a failure of theirs; they go when this one can.
                const rest = rows.slice(index + 1).map((other) => other.id);
                if (rest.length > 0) {
                    await this.prisma.outboxMessage.updateMany({
                        where: { id: { in: rest } },
                        data: { nextAttemptAt: retryAt },
                    });
                }
                this.logger.warn(
                    `Outbox message ${row.id} (${row.topic}) not sent, try ${failures}; next at ${retryAt.toISOString()}: ${String(error)}`,
                );
                return true;
            }
            await this.prisma.outboxMessage.update({
                where: { id: row.id },
                data: { publishedAt: new Date(), lastError: null },
            });
        }
        return false;
    }
}
