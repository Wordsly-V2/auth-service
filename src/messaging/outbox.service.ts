import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

/**
 * Writes events to the outbox. Always called with the transaction of the
 * change the event announces, so the two commit or roll back together: an
 * account is never deleted without its `user_deleted` being owed to Kafka, and
 * no event goes out for a delete that rolled back.
 */
@Injectable()
export class OutboxService {
    async enqueue(
        tx: Prisma.TransactionClient,
        topic: string,
        payload: Prisma.InputJsonObject,
        key?: string,
    ): Promise<string> {
        const id = uuidv7();
        await tx.outboxMessage.create({
            data: { id, topic, key: key ?? null, payload },
        });
        return id;
    }
}
