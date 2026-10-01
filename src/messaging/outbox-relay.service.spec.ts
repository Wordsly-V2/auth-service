import {
    OUTBOX_BATCH_SIZE,
    OutboxRelayService,
    outboxBackoffMs,
} from '@/messaging/outbox-relay.service';

describe('outboxBackoffMs', () => {
    it('doubles from 5 seconds and stops at 5 minutes', () => {
        expect(outboxBackoffMs(1)).toBe(5_000);
        expect(outboxBackoffMs(2)).toBe(10_000);
        expect(outboxBackoffMs(4)).toBe(40_000);
        expect(outboxBackoffMs(30)).toBe(300_000);
    });
});

describe('OutboxRelayService', () => {
    const row = (id: string, minute: number, attempts = 0) => ({
        id,
        topic: 'user_deleted',
        key: `key-${id}`,
        payload: { userLoginId: id },
        attempts,
        created_at: new Date(Date.UTC(2026, 9, 1, 9, minute)),
    });

    let prisma: {
        $queryRaw: jest.Mock;
        outboxMessage: {
            update: jest.Mock;
            updateMany: jest.Mock;
            count: jest.Mock;
        };
    };
    let producer: { enabled: boolean; send: jest.Mock };
    let relay: OutboxRelayService;

    beforeEach(() => {
        prisma = {
            $queryRaw: jest.fn().mockResolvedValue([]),
            outboxMessage: {
                update: jest.fn().mockResolvedValue({}),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
                count: jest.fn().mockResolvedValue(0),
            },
        };
        producer = {
            enabled: true,
            send: jest.fn().mockResolvedValue(undefined),
        };
        relay = new OutboxRelayService(prisma as never, producer as never);
    });

    it('publishes claimed rows oldest first and marks them published', async () => {
        prisma.$queryRaw.mockResolvedValueOnce([row('b', 2), row('a', 1)]);

        await relay.kick();

        expect(producer.send.mock.calls).toEqual([
            ['user_deleted', [{ key: 'key-a', value: '{"userLoginId":"a"}' }]],
            ['user_deleted', [{ key: 'key-b', value: '{"userLoginId":"b"}' }]],
        ]);
        expect(prisma.outboxMessage.update).toHaveBeenCalledWith({
            where: { id: 'a' },
            data: { publishedAt: expect.any(Date) as Date, lastError: null },
        });
        expect(prisma.outboxMessage.update).toHaveBeenCalledTimes(2);
    });

    it('on a failed send backs the row off, releases the rest and stops the round', async () => {
        prisma.$queryRaw.mockResolvedValueOnce([
            row('a', 1, 2),
            row('b', 2),
            row('c', 3),
        ]);
        producer.send.mockRejectedValueOnce(new Error('broker down'));

        await relay.kick();

        expect(producer.send).toHaveBeenCalledTimes(1);
        const [[failed]] = prisma.outboxMessage.update.mock.calls as [
            [{ where: unknown; data: { nextAttemptAt: Date } }],
        ];
        expect(failed.where).toEqual({ id: 'a' });
        expect(failed.data).toMatchObject({
            attempts: 3,
            lastError: 'Error: broker down',
        });
        expect(prisma.outboxMessage.updateMany).toHaveBeenCalledWith({
            where: { id: { in: ['b', 'c'] } },
            data: { nextAttemptAt: failed.data.nextAttemptAt },
        });
        // One claim only: a down broker is not retried within the round.
        expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('claims again while batches come back full', async () => {
        const full = Array.from({ length: OUTBOX_BATCH_SIZE }, (_, i) =>
            row(`r${i}`, i),
        );
        prisma.$queryRaw.mockResolvedValueOnce(full).mockResolvedValueOnce([]);

        await relay.kick();

        expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('shares the running round with a concurrent kick', async () => {
        prisma.$queryRaw.mockResolvedValue([]);
        const first = relay.kick();
        const second = relay.kick();
        expect(second).toBe(first);
        await first;
    });

    it('does nothing without Kafka, leaving rows to wait', async () => {
        producer.enabled = false;
        await relay.kick();
        expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('never rejects when the database is down', async () => {
        prisma.$queryRaw.mockRejectedValue(new Error('db down'));
        await expect(relay.kick()).resolves.toBeUndefined();
    });
});
