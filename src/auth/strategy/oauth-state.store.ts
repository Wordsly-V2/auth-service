import { randomBytes, timingSafeEqual } from 'crypto';
import type { Request } from 'express';

export const OAUTH_STATE_COOKIE = 'oauth_state';

/** Long enough for a slow consent screen, short enough to be single-sitting. */
const STATE_TTL_MS = 15 * 60 * 1000;

type StoreCallback = (err: Error | null, state?: string) => void;
type VerifyCallback = (
    err: Error | null,
    ok: boolean,
    info?: { message: string },
) => void;

/**
 * OAuth `state`, kept in a short-lived cookie instead of a server session.
 *
 * Without a state check the callback accepts any authorization code, so an
 * attacker can finish their own Google login in a victim's browser and sign the
 * victim into the attacker's account (login CSRF). The nonce is set as an
 * httpOnly cookie when the handshake starts and must come back unchanged on the
 * callback; a forged callback link carries a state the victim's browser never
 * received a cookie for.
 *
 * `sameSite: 'lax'` is required, not a preference: Google's redirect back is a
 * top-level cross-site navigation, which is exactly what lax still sends.
 *
 * Method arities matter — passport-oauth2 picks the call signature from them,
 * which is also why this doesn't `implement` its overloaded StateStore typing.
 */
export class CookieStateStore {
    constructor(private readonly secure: boolean) {}

    store(req: Request, _meta: unknown, callback: StoreCallback): void {
        const state = randomBytes(24).toString('base64url');
        req.res?.cookie(OAUTH_STATE_COOKIE, state, {
            httpOnly: true,
            secure: this.secure,
            sameSite: 'lax',
            path: '/auth/google',
            maxAge: STATE_TTL_MS,
        });
        callback(null, state);
    }

    verify(
        req: Request,
        providedState: string,
        callback: VerifyCallback,
    ): void {
        const expected = (req.cookies as Record<string, string> | undefined)?.[
            OAUTH_STATE_COOKIE
        ];
        // Single use: clear it whether or not it matches.
        req.res?.clearCookie(OAUTH_STATE_COOKIE, {
            httpOnly: true,
            secure: this.secure,
            sameSite: 'lax',
            path: '/auth/google',
        });

        if (
            !expected ||
            !providedState ||
            !safeEqual(expected, providedState)
        ) {
            callback(null, false, {
                message: 'Invalid authorization request state.',
            });
            return;
        }
        callback(null, true);
    }
}

function safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
}
