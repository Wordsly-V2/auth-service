-- CreateTable
CREATE TABLE "user_logins" (
    "id" UUID NOT NULL,
    "provider_user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_logins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "user_login_id" UUID NOT NULL,
    "gmail" TEXT,
    "display_name" TEXT NOT NULL,
    "picture_url" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_login_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "jwt_id" TEXT NOT NULL,
    "allocated_ip" TEXT,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_logins_provider_user_id_key" ON "user_logins"("provider_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_user_login_id_key" ON "users"("user_login_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_gmail_key" ON "users"("gmail");

-- CreateIndex
CREATE INDEX "users_user_login_id_idx" ON "users"("user_login_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_user_login_id_key" ON "refresh_tokens"("user_login_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_jwt_id_key" ON "refresh_tokens"("jwt_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_login_id_idx" ON "refresh_tokens"("user_login_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_user_login_id_fkey" FOREIGN KEY ("user_login_id") REFERENCES "user_logins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_login_id_fkey" FOREIGN KEY ("user_login_id") REFERENCES "user_logins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
