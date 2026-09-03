import { SigningKeyService } from '@/keys/signing-key.service';
import { generateKeyPairSync } from 'node:crypto';

/**
 * The key set is the root of trust for every service, so the properties pinned
 * here are the ones a mistake would be silent about: that all keys are
 * published (or tokens signed by the previous one stop verifying mid-rotation),
 * that the *named* key signs, and that a kid naming nothing stops the boot
 * rather than quietly signing with some other key.
 */
describe('SigningKeyService', () => {
    const makePem = (): string =>
        generateKeyPairSync('rsa', {
            modulusLength: 2048,
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
            publicKeyEncoding: { type: 'spki', format: 'pem' },
        }).privateKey;

    const encodeKeySet = (entries: { kid: string; pem: string }[]): string =>
        Buffer.from(
            JSON.stringify(
                entries.map((entry) => ({
                    kid: entry.kid,
                    privateKey: Buffer.from(entry.pem).toString('base64'),
                })),
            ),
        ).toString('base64');

    const build = (values: Record<string, string | undefined>) =>
        new SigningKeyService({
            get: (key: string) => values[key],
        } as never);

    it('publishes every loaded key so rotation does not invalidate live tokens', async () => {
        const service = build({
            'jwt.signingKeys': encodeKeySet([
                { kid: 'old', pem: makePem() },
                { kid: 'new', pem: makePem() },
            ]),
            'jwt.activeKid': 'new',
        });

        await service.onModuleInit();

        const kids = service.getPublicJwks().keys.map((key) => key.kid);
        expect(kids.sort()).toEqual(['new', 'old']);
    });

    it('publishes public material only', async () => {
        const service = build({
            'jwt.signingKeys': encodeKeySet([{ kid: 'only', pem: makePem() }]),
            'jwt.activeKid': 'only',
        });

        await service.onModuleInit();

        const [jwk] = service.getPublicJwks().keys;
        expect(jwk).toMatchObject({ kty: 'RSA', use: 'sig', alg: 'RS256' });
        // The private exponent and primes must never leave the service.
        expect(jwk.d).toBeUndefined();
        expect(jwk.p).toBeUndefined();
        expect(jwk.q).toBeUndefined();
    });

    it('signs with the key JWT_ACTIVE_KID names, not merely the first one', async () => {
        const service = build({
            'jwt.signingKeys': encodeKeySet([
                { kid: 'old', pem: makePem() },
                { kid: 'new', pem: makePem() },
            ]),
            'jwt.activeKid': 'new',
        });

        await service.onModuleInit();

        expect(service.getActiveKey().kid).toBe('new');
    });

    it('refuses to boot when the active kid names no loaded key', async () => {
        const service = build({
            'jwt.signingKeys': encodeKeySet([{ kid: 'only', pem: makePem() }]),
            'jwt.activeKid': 'typo',
        });

        await expect(service.onModuleInit()).rejects.toThrow(/typo/);
    });

    it('refuses to boot with no keys at all', async () => {
        await expect(build({}).onModuleInit()).rejects.toThrow(
            /No JWT signing keys/,
        );
    });
});
