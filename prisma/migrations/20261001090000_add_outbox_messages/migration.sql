-- Transactional outbox for Kafka events (first one: user_deleted). Written in
-- the same transaction as the change, published by OutboxRelayService.
CREATE TABLE "outbox_messages" (
    "id" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "key" TEXT,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "outbox_messages_published_at_next_attempt_at_idx" ON "outbox_messages"("published_at", "next_attempt_at");
