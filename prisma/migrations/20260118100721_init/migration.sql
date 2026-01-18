-- CreateTable
CREATE TABLE "user_logins" (
    "id" TEXT NOT NULL,
    "gmail" TEXT NOT NULL,
    "google_id" TEXT,
    "facebook_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_logins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "user_login_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "display_name" TEXT NOT NULL,
    "picture_url" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_login_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "jwt_id" TEXT NOT NULL,
    "allocated_ip" TEXT,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_logins_gmail_key" ON "user_logins"("gmail");

-- CreateIndex
CREATE UNIQUE INDEX "user_logins_google_id_key" ON "user_logins"("google_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_logins_facebook_id_key" ON "user_logins"("facebook_id");

-- CreateIndex
CREATE INDEX "user_logins_gmail_idx" ON "user_logins"("gmail");

-- CreateIndex
CREATE UNIQUE INDEX "users_user_login_id_key" ON "users"("user_login_id");

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
