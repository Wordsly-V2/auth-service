import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer } from 'kafkajs';

/**
 * The Kafka producer behind the outbox relay. Unlike the other services'
 * producers it never gives up on a broker: it connects on first use, and after
 * a failed connect or send it drops the connection so the next call starts
 * over. That is what lets the outbox drain by itself once a broker that was
 * down comes back, with no restart.
 */
@Injectable()
export class KafkaProducerService implements OnModuleDestroy {
    private readonly logger = new Logger(KafkaProducerService.name);
    private readonly brokers: string[];
    private producer: Producer | null = null;
    private connecting: Promise<Producer> | null = null;

    constructor(private readonly config: ConfigService) {
        this.brokers = (this.config.get<string>('kafka.brokers') ?? '')
            .split(',')
            .map((broker) => broker.trim())
            .filter(Boolean);
    }

    /** False when `KAFKA_BROKERS` is empty: events then wait in the outbox. */
    get enabled(): boolean {
        return this.brokers.length > 0;
    }

    /** Sends messages to one topic, in order. Throws when Kafka can't take them. */
    async send(
        topic: string,
        messages: { key?: string | null; value: string }[],
    ): Promise<void> {
        const producer = await this.connected();
        try {
            await producer.send({ topic, messages });
        } catch (error) {
            await this.drop();
            throw error;
        }
    }

    async onModuleDestroy(): Promise<void> {
        await this.drop();
    }

    private connected(): Promise<Producer> {
        if (!this.enabled) {
            return Promise.reject(new Error('Kafka is not configured'));
        }
        if (this.producer) return Promise.resolve(this.producer);
        this.connecting ??= this.connect().finally(() => {
            this.connecting = null;
        });
        return this.connecting;
    }

    private async connect(): Promise<Producer> {
        const ca = this.config.get<string>('kafka.ca') ?? '';
        const cert = this.config.get<string>('kafka.cert') ?? '';
        const key = this.config.get<string>('kafka.key') ?? '';
        const producer = new Kafka({
            clientId: 'auth-service-producer',
            brokers: this.brokers,
            ssl:
                ca && cert && key
                    ? { rejectUnauthorized: true, ca, cert, key }
                    : undefined,
            // Fail fast: the relay retries on its own schedule, so a long
            // kafkajs retry loop would only hold the batch up.
            connectionTimeout: 3000,
            retry: { retries: 2, initialRetryTime: 300 },
        }).producer({ allowAutoTopicCreation: true });
        await producer.connect();
        this.producer = producer;
        this.logger.log(
            `Kafka producer connected to ${this.brokers.join(',')}`,
        );
        return producer;
    }

    private async drop(): Promise<void> {
        const producer = this.producer;
        this.producer = null;
        await producer?.disconnect().catch(() => undefined);
    }
}
