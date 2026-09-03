import { JwtAuthPayload, TokenType } from '@/auth/dto/auth.dto';
import { SigningKeyService } from '@/keys/signing-key.service';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignJWT, jwtVerify, decodeProtectedHeader } from 'jose';

/**
 * Mints and verifies this service's tokens.
 *
 * Access and refresh tokens used to be signed with an identical payload and the
 * *same* `jti`, differing only in expiry — which made a 30-day refresh token a
 * perfectly valid 30-day bearer token. They are now separated twice over: by
 * `aud` (enforced during verification) and by an explicit `typ`. Either check
 * alone would close the hole; both cost nothing and fail independently.
 */

export interface IssuedTokens {
    accessToken: string;
    refreshToken: string;
    /** The refresh token's `jti` — the value persisted for rotation and reuse detection. */
    refreshJti: string;
    /** Session id, shared by the pair and carried across every rotation. */
    sid: string;
}

@Injectable()
export class TokenService {
    constructor(
        private readonly signingKeyService: SigningKeyService,
        private readonly configService: ConfigService,
    ) {}

    async issueTokens(params: {
        userLoginId: string;
        sid: string;
        accessJti: string;
        refreshJti: string;
    }): Promise<IssuedTokens> {
        const [accessToken, refreshToken] = await Promise.all([
            this.sign({
                userLoginId: params.userLoginId,
                sid: params.sid,
                jti: params.accessJti,
                typ: 'access',
                audience: this.audienceFor('access'),
                expiresIn: this.configService.get<string>(
                    'jwt.expiresIn',
                ) as string,
            }),
            this.sign({
                userLoginId: params.userLoginId,
                sid: params.sid,
                jti: params.refreshJti,
                typ: 'refresh',
                audience: this.audienceFor('refresh'),
                expiresIn: this.configService.get<string>(
                    'jwt.refreshTokenExpiresIn',
                ) as string,
            }),
        ]);

        return {
            accessToken,
            refreshToken,
            refreshJti: params.refreshJti,
            sid: params.sid,
        };
    }

    /**
     * Verify a token this service issued.
     *
     * Done in-process against the loaded private keys rather than over HTTP:
     * this service *is* the issuer, so fetching its own JWKS through the network
     * would be a pointless round trip and a needless failure mode.
     */
    async verify(token: string, expected: TokenType): Promise<JwtAuthPayload> {
        const kid = this.readKid(token);
        const key = this.signingKeyService.getKeyByKid(kid);
        if (!key) {
            throw new UnauthorizedException('Unknown token signing key');
        }

        try {
            const { payload } = await jwtVerify(token, key.privateKey, {
                algorithms: ['RS256'],
                issuer: this.configService.get<string>('jwt.issuer'),
                audience: this.audienceFor(expected),
                clockTolerance: 60,
            });

            if (payload.typ !== expected) {
                throw new UnauthorizedException(
                    `Expected a ${expected} token`,
                );
            }

            return payload as unknown as JwtAuthPayload;
        } catch (error) {
            if (error instanceof UnauthorizedException) throw error;
            throw new UnauthorizedException('Invalid token');
        }
    }

    private audienceFor(typ: TokenType): string {
        return this.configService.get<string>(
            typ === 'access' ? 'jwt.audience' : 'jwt.refreshAudience',
        ) as string;
    }

    private readKid(token: string): string | undefined {
        try {
            return decodeProtectedHeader(token).kid;
        } catch {
            throw new UnauthorizedException('Malformed token');
        }
    }

    private async sign(params: {
        userLoginId: string;
        sid: string;
        jti: string;
        typ: TokenType;
        audience: string;
        expiresIn: string;
    }): Promise<string> {
        const { kid, privateKey } = this.signingKeyService.getActiveKey();

        return new SignJWT({
            sub: params.userLoginId,
            // Legacy claim name, emitted alongside `sub` for one migration
            // window so consumers can switch over independently.
            userLoginId: params.userLoginId,
            sid: params.sid,
            typ: params.typ,
        })
            .setProtectedHeader({ alg: 'RS256', kid })
            .setIssuer(this.configService.get<string>('jwt.issuer') as string)
            .setAudience(params.audience)
            .setJti(params.jti)
            .setIssuedAt()
            .setExpirationTime(params.expiresIn)
            .sign(privateKey);
    }
}
