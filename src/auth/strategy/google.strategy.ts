import { IOAuthProfileDTO, IOAuthUserDTO } from '@/auth/dto/auth.dto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import type { StateStore } from 'passport-oauth2';
import { CookieStateStore } from './oauth-state.store';

/**
 * The Google handshake, which now runs in the service that owns identity.
 *
 * `callbackURL` is a public address, so it points at the gateway — which proxies
 * `/auth/**` here untouched. Nothing in the Google console changes as a result
 * of the move.
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
    constructor(private readonly configService: ConfigService) {
        super({
            clientID: configService.get('googleOAuth.clientId') as string,
            clientSecret: configService.get(
                'googleOAuth.clientSecret',
            ) as string,
            callbackURL: configService.get('googleOAuth.redirectUri') as string,
            scope: ['email', 'profile'],
            // Binds the callback to the browser that started the login, which
            // is what stops login CSRF. See CookieStateStore for the cast.
            store: new CookieStateStore(
                configService.get<boolean>(
                    'refreshTokenCookieOptions.secure',
                ) ?? false,
            ) as unknown as StateStore,
        });
    }

    validate(
        _accessToken: string,
        _refreshToken: string,
        profile: IOAuthProfileDTO,
        done: VerifyCallback,
    ) {
        const { id, displayName, emails, photos, provider } = profile;

        const user: IOAuthUserDTO = {
            id,
            displayName,
            email: emails[0]?.value,
            picture: photos[0]?.value,
            provider: provider as IOAuthUserDTO['provider'],
        };

        done(null, user);
    }
}
