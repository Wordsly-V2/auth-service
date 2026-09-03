import { Public } from '@/common/decorators/public.decorator';
import { SigningKeyService } from '@/keys/signing-key.service';
import { Controller, Get, Header } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * OIDC discovery surface.
 *
 * This service is an issuer, not a full OpenID Provider: there is no
 * authorization endpoint and no authorization-code flow, so `response_types`
 * is empty rather than advertising a flow that does not exist. What the
 * document is really for is `jwks_uri` — it lets every other service verify
 * tokens from a published key set instead of sharing a copied-around PEM.
 */
@Controller('.well-known')
export class WellKnownController {
    constructor(
        private readonly signingKeyService: SigningKeyService,
        private readonly configService: ConfigService,
    ) {}

    @Public()
    @Get('openid-configuration')
    @Header('Cache-Control', 'public, max-age=300')
    discovery() {
        const issuer = this.configService.get<string>('jwt.issuer');
        const publicBaseUrl =
            this.configService.get<string>('publicBaseUrl') ?? issuer;

        return {
            issuer,
            jwks_uri: `${publicBaseUrl}/.well-known/jwks.json`,
            id_token_signing_alg_values_supported: ['RS256'],
            subject_types_supported: ['public'],
            response_types_supported: [],
            grant_types_supported: ['refresh_token'],
            claims_supported: [
                'iss',
                'sub',
                'aud',
                'exp',
                'iat',
                'jti',
                'sid',
                'typ',
            ],
        };
    }

    @Public()
    @Get('jwks.json')
    @Header('Cache-Control', 'public, max-age=300')
    jwks() {
        return this.signingKeyService.getPublicJwks();
    }
}
