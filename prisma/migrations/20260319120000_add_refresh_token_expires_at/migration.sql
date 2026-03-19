-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN "expires_at" TIMESTAMPTZ;

UPDATE "refresh_tokens"
SET "expires_at" = "created_at" + interval '30 days'
WHERE "expires_at" IS NULL;

ALTER TABLE "refresh_tokens" ALTER COLUMN "expires_at" SET NOT NULL;

CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");
