export const cacheKeys = {
  userProfile: () => 'profile',
};

export const userCachePattern = (userLoginId: string): string =>
  `auth:u:${userLoginId}:*`;
