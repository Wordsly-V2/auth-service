export enum CacheKind {
  UserProfile = 'userProfile',
}

/** TTL in seconds per cache kind. Writes invalidate cache; TTL is a safety net. */
export const CACHE_TTL_SECONDS: Record<CacheKind, number> = {
  [CacheKind.UserProfile]: 60 * 60,
};
