-- Session id linking an access token to its refresh token.
--
-- Access and refresh tokens used to share a `jti`, which is what made logout by
-- `jti` work. They now get separate ids (so a refresh token can no longer be
-- presented as an access token), so the pair needs something else in common.
-- Existing rows are backfilled from their own primary key: each surviving row is
-- its own session, which is exactly right for tokens issued before this change.
ALTER TABLE "refresh_tokens" ADD COLUMN "session_id" UUID;

UPDATE "refresh_tokens" SET "session_id" = "id" WHERE "session_id" IS NULL;

ALTER TABLE "refresh_tokens" ALTER COLUMN "session_id" SET NOT NULL;

-- Deliberately not unique: rotation deletes the old row and inserts a new one
-- carrying the same session, and a retried transaction must not collide.
CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");
