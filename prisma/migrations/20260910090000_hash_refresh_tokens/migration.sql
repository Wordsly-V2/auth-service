-- Store refresh tokens as a hash rather than as the token itself.
--
-- The column held the raw 30-day JWT, so anyone who could read the table -- a
-- backup, a replica, a log of a query -- held usable credentials for every
-- signed-in learner. Nothing ever queried the column by value (lookups go
-- through `jwt_id`), so what is stored can be a one-way hash instead.
--
-- SHA-256, deliberately, not bcrypt/argon2: the input is a high-entropy signed
-- token, not a human-chosen password, so there is nothing to brute-force and a
-- deliberately slow hash would only add latency to every refresh.
--
-- Existing values cannot be converted: hashing is one-way and the plaintext is
-- what we are removing. Rather than leave two formats live and have to guess
-- which format a row holds, every session is invalidated once. Learners sign in
-- again; their accounts, progress and queued offline practice are untouched.
DELETE FROM "refresh_tokens";

ALTER TABLE "refresh_tokens" DROP COLUMN "token";

ALTER TABLE "refresh_tokens" ADD COLUMN "token_hash" TEXT NOT NULL;

CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");
