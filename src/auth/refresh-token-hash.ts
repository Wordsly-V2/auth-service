import { createHash } from 'node:crypto';

/**
 * The value stored for a refresh token.
 *
 * SHA-256 rather than a password hash: the input is a signed JWT with far more
 * entropy than any passphrase, so there is no dictionary to run against it and
 * a deliberately slow KDF would only add latency to every refresh. What matters
 * is that the stored form cannot be presented as a credential.
 *
 * Unsalted on purpose — a per-row salt would make the value unfindable by
 * lookup, and the token's own `jti` already makes every input unique.
 */
export function hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}
