-- Rotation used to delete the old refresh token row, so a second refresh racing
-- the first (another tab, or a retry after a lost response) found nothing and
-- was treated as theft. Rotated rows are now kept, stamped with when they were
-- exchanged, for a short grace window. Existing rows are all unrotated.
ALTER TABLE "refresh_tokens" ADD COLUMN "rotated_at" TIMESTAMPTZ;
