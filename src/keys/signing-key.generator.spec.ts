import {
    appendKey,
    decodeKeySet,
    defaultKid,
    encodeKeySet,
    generateSigningKey,
} from '@/keys/signing-key.generator';
import { SigningKeyService } from '@/keys/signing-key.service';

/**
 * The generator's output is only useful if the loader accepts it, so these
 * assert the round trip rather than the shape of the string. The append case is
 * the reason this module exists: a generator that quietly replaced the set
 * would invalidate every token signed by the key it dropped.
 */
describe('signing-key generator', () => {
    const build = (encoded: string, activeKid?: string) =>
        new SigningKeyService({
            get: (key: string) =>
                ({ 'jwt.signingKeys': encoded, 'jwt.activeKid': activeKid })[
                    key
                ],
        } as never);

    it('produces a key set the service boots from', async () => {
        const key = generateSigningKey('2026-09');

        const service = build(encodeKeySet([key]), '2026-09');
        await service.onModuleInit();

        expect(service.getPublicJwks().keys.map((jwk) => jwk.kid)).toEqual([
            '2026-09',
        ]);
        expect(service.getActiveKey().kid).toBe('2026-09');
    });

    it('emits PKCS#8, which is the only form the loader can import', () => {
        const pem = Buffer.from(
            generateSigningKey('pkcs8-check').privateKey,
            'base64',
        ).toString('utf8');

        expect(pem).toContain('-----BEGIN PRIVATE KEY-----');
        expect(pem).not.toContain('-----BEGIN RSA PRIVATE KEY-----');
    });

    it('keeps every existing key when appending, so mid-rotation tokens still verify', async () => {
        const existing = encodeKeySet([
            generateSigningKey('2026-01-legacy'),
            generateSigningKey('2026-09-active'),
        ]);

        const appended = encodeKeySet(
            appendKey(existing, generateSigningKey('2026-10')),
        );

        const service = build(appended, '2026-10');
        await service.onModuleInit();

        expect(service.getPublicJwks().keys.map((jwk) => jwk.kid)).toEqual([
            '2026-01-legacy',
            '2026-09-active',
            '2026-10',
        ]);
    });

    it('starts a fresh set when there is nothing to append to', () => {
        expect(appendKey(undefined, generateSigningKey('first'))).toHaveLength(
            1,
        );
        expect(appendKey('   ', generateSigningKey('first'))).toHaveLength(1);
    });

    it('refuses to append a duplicate kid rather than replacing the key', () => {
        const existing = encodeKeySet([generateSigningKey('2026-09')]);

        expect(() =>
            appendKey(existing, generateSigningKey('2026-09')),
        ).toThrow(/already in the set/);
    });

    it('reads back the raw-JSON and raw-PEM forms the loader also accepts', () => {
        const key = generateSigningKey('raw');
        const rawPem = Buffer.from(key.privateKey, 'base64').toString('utf8');
        const rawJson = JSON.stringify([{ kid: 'raw', privateKey: rawPem }]);

        expect(decodeKeySet(rawJson)).toHaveLength(1);
        expect(decodeKeySet(encodeKeySet([key]))[0].kid).toBe('raw');
    });

    it('rejects an existing set that is not a usable key set', () => {
        expect(() => decodeKeySet('not json at all')).toThrow(/not valid JSON/);
        expect(() => decodeKeySet('[]')).toThrow(/non-empty JSON array/);
        expect(() =>
            decodeKeySet(JSON.stringify([{ kid: 'x', privateKey: 'nope' }])),
        ).toThrow(/not a PEM document/);
        expect(() =>
            decodeKeySet(JSON.stringify([{ privateKey: 'nope' }])),
        ).toThrow(/non-empty "kid"/);
    });

    it('defaults the kid to the month, the cadence rotation is documented at', () => {
        expect(defaultKid(new Date('2026-09-03T00:00:00'))).toBe('2026-09');
    });

    it('needs a non-empty kid', () => {
        expect(() => generateSigningKey('  ')).toThrow(/non-empty kid/);
    });
});
