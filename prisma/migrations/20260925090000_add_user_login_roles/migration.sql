-- Authorization roles for the access token's `roles` claim (Wordsly Path admin).
-- Existing accounts get none; admins are granted by ADMIN_EMAILS at login or by
-- `npm run admin:grant`.
ALTER TABLE "user_logins" ADD COLUMN "roles" TEXT[] DEFAULT ARRAY[]::TEXT[];
