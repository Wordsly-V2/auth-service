import { IOAuthProfileDTO, IOAuthUserDTO } from '@/auth/dto/auth.dto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';

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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        super({
            clientID: configService.get('googleOAuth.clientId') as string,
            clientSecret: configService.get(
                'googleOAuth.clientSecret',
            ) as string,
            callbackURL: configService.get('googleOAuth.redirectUri') as string,
            scope: ['email', 'profile'],
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

        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        done(null, user);
    }
}
