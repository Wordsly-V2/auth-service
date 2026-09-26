/** The only `UserLogin.status` that may sign in; anything else is locked out. */
export const ACTIVE_USER_LOGIN_STATUS = 'active';

/**
 * Every value `UserLogin.status` may hold. A TEXT column, never a database enum:
 * the allowed values live here and are checked at the boundary (`@IsIn`).
 * Anything but `active` is refused at login and refresh (`assertActive` in
 * `auth.service.ts`).
 */
export const USER_LOGIN_STATUSES = [
    ACTIVE_USER_LOGIN_STATUS,
    'suspended',
] as const;
export type UserLoginStatus = (typeof USER_LOGIN_STATUSES)[number];
