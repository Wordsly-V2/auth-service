import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import ms from 'ms';

export const REFRESH_TOKEN_COOKIE = 'refresh_token';

/**
 * Owns the refresh-token cookie.
 *
 * Set and clear go through the same options object on purpose: a cookie is only
 * removed when path, sameSite and secure match the ones it was created with.
 * Clearing with defaults silently left the cookie in place, so logout did not
 * actually end the session.
 */
@Injectable()
export class AuthCookieService {
    constructor(private readonly configService: ConfigService) {}

    /**
     * True when the refresh token is returned to the client instead of being
     * kept in an httpOnly cookie. Cross-origin deployments need this.
     */
    isBodyDelivery(): boolean {
        return (
            this.configService.get<string>('refreshTokenDelivery') === 'body'
        );
    }

    set(res: Response, refreshToken: string): void {
        const { maxAge, ...options } = this.options();
        res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
            ...options,
            maxAge,
        });
    }

    clear(res: Response): void {
        // Same attributes as `set`, minus maxAge — anything else is a no-op.
        const { maxAge: _maxAge, ...options } = this.options();
        res.clearCookie(REFRESH_TOKEN_COOKIE, options);
    }

    private options(): CookieOptions & { maxAge: number } {
        const get = <T>(key: string) =>
            this.configService.get<T>(`refreshTokenCookieOptions.${key}`);

        return {
            httpOnly: get<boolean>('httpOnly') ?? true,
            secure: get<boolean>('secure') ?? false,
            sameSite: (get<string>('sameSite') ?? 'lax') as CookieOptions['sameSite'],
            path: get<string>('path') ?? '/auth',
            maxAge: ms((get<string>('maxAge') ?? '30d') as ms.StringValue),
        };
    }
}
