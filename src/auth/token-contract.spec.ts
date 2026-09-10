import { TokenService } from '@/auth/token.service';
import { SigningKeyService } from '@/keys/signing-key.service';
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { generateKeyPairSync } from 'node:crypto';

/**
 * End-to-end contract: a token this service mints must verify against the JWKS
 * it publishes, using nothing but the public key set -- which is exactly what
 * every other service will do. Also pins the separation that stops a refresh
 * token being spent as an access token.
 */
describe('token <-> JWKS contract', () => {
    const ISSUER = 'http://localhost:3000';
    const USER = '11111111-1111-1111-1111-111111111111';

    const config = {
        publicBaseUrl: ISSUER,
        'jwt.audience': 'wordsly-api',
        'jwt.refreshAudience': 'wordsly-auth',
        'jwt.expiresIn': '15m',
        'jwt.refreshTokenExpiresIn': '30d',
        'jwt.activeKid': 'active',
    } as Record<string, string>;

    let keys: SigningKeyService;
    let tokens: TokenService;

    beforeAll(async () => {
        const pem = (): string =>
            generateKeyPairSync('rsa', {
                modulusLength: 2048,
                privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
                publicKeyEncoding: { type: 'spki', format: 'pem' },
            }).privateKey;

        const keySet = Buffer.from(
            JSON.stringify([
                {
                    kid: 'retired',
                    privateKey: Buffer.from(pem()).toString('base64'),
                },
                {
                    kid: 'active',
                    privateKey: Buffer.from(pem()).toString('base64'),
                },
            ]),
        ).toString('base64');

        keys = new SigningKeyService({
            get: (key: string) =>
                ({ ...config, 'jwt.signingKeys': keySet })[key],
        } as never);
        await keys.onModuleInit();

        tokens = new TokenService(keys, {
            get: (k: string) => config[k],
        } as never);
    });

    const issue = () =>
        tokens.issueTokens({
            userLoginId: USER,
            sid: 'session-1',
            accessJti: 'access-jti',
            refreshJti: 'refresh-jti',
        });

    it('an access token verifies against the published JWKS alone', async () => {
        const { accessToken } = await issue();

        // No private key in scope here -- only what /.well-known/jwks.json serves.
        const jwks = createLocalJWKSet(keys.getPublicJwks() as never);
        const { payload } = await jwtVerify(accessToken, jwks, {
            issuer: ISSUER,
            audience: 'wordsly-api',
            algorithms: ['RS256'],
        });

        expect(decodeProtectedHeader(accessToken).kid).toBe('active');
        expect(payload).toMatchObject({
            sub: USER,
            userLoginId: USER,
            sid: 'session-1',
            typ: 'access',
            jti: 'access-jti',
            iss: ISSUER,
            aud: 'wordsly-api',
        });
    });

    it('gives the pair different jtis so a refresh token is not an access token', async () => {
        const { accessToken, refreshToken } = await issue();
        const jwks = createLocalJWKSet(keys.getPublicJwks() as never);

        const access = await jwtVerify(accessToken, jwks, {
            audience: 'wordsly-api',
        });
        const refresh = await jwtVerify(refreshToken, jwks, {
            audience: 'wordsly-auth',
        });

        expect(access.payload.jti).not.toBe(refresh.payload.jti);
        expect(refresh.payload.sid).toBe(access.payload.sid);
    });

    it('rejects a refresh token presented to an access-token audience', async () => {
        const { refreshToken } = await issue();
        const jwks = createLocalJWKSet(keys.getPublicJwks() as never);

        await expect(
            jwtVerify(refreshToken, jwks, {
                issuer: ISSUER,
                audience: 'wordsly-api',
                algorithms: ['RS256'],
            }),
        ).rejects.toThrow();
    });

    it('rejects a refresh token handed to verify() as an access token', async () => {
        const { refreshToken } = await issue();
        await expect(tokens.verify(refreshToken, 'access')).rejects.toThrow();
    });

    it('accepts each token as its own type', async () => {
        const { accessToken, refreshToken } = await issue();
        await expect(
            tokens.verify(accessToken, 'access'),
        ).resolves.toMatchObject({ typ: 'access' });
        await expect(
            tokens.verify(refreshToken, 'refresh'),
        ).resolves.toMatchObject({ typ: 'refresh' });
    });
});
