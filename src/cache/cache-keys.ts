export const cacheKeys = {
  // Versioned: bump whenever the cached profile payload shape changes, so
  // already-cached entries are ignored rather than served with missing fields.
  userProfile: () => 'profile:v2',
};

export const userCachePattern = (userLoginId: string): string =>
  `auth:u:${userLoginId}:*`;
