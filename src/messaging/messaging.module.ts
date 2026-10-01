import { KafkaProducerService } from '@/messaging/kafka-producer.service';
import { OutboxRelayService } from '@/messaging/outbox-relay.service';
import { OutboxService } from '@/messaging/outbox.service';
import { Module } from '@nestjs/common';

/** Kafka for auth-service: everything goes through the outbox. */
@Module({
    providers: [KafkaProducerService, OutboxService, OutboxRelayService],
    exports: [OutboxService, OutboxRelayService],
})
export class MessagingModule {}
