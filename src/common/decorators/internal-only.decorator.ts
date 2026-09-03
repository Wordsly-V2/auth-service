import { SetMetadata } from '@nestjs/common';

export const IS_INTERNAL_ONLY_KEY = 'isInternalOnly';

/**
 * Restrict a route to peer services — a valid end-user token is NOT enough.
 *
 * The default for an authenticated route is "internal token or user token",
 * which is right for routes that act on the caller's own data. It is badly wrong
 * for routes that mint or destroy credentials: `login-oauth` issues tokens for
 * whatever provider identity it is handed, and `logout` acts on whatever user
 * the body names. Under the default rule any logged-in user could call those for
 * somebody else, so they have to opt out of user tokens explicitly.
 */
export const InternalOnly = () => SetMetadata(IS_INTERNAL_ONLY_KEY, true);
