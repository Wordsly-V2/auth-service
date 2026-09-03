import { generateKeyPairSync } from 'node:crypto';
import {
    decodeMaybeBase64,
    PRIVATE_PEM_MARKER,
} from '@/keys/signing-key.service';

/**
 * Building `JWT_SIGNING_KEYS` values, the counterpart to `SigningKeyService`
 * reading them.
 *
 * This exists mainly for `appendKey`. Rotation means adding a key to the set
 * while the previous one stays published, so a generator that can only emit a
 * fresh single-key array is a trap: using it mid-rotation drops the old key and
 * every token signed by it stops verifying. Anything that parses a set here
 * defers to the loader's own helpers, so the two can never disagree about what
 * a valid value looks like.
 */

export interface EncodedSigningKey {
    /** Names the key in the JWKS and in every token header it signs. */
    kid: string;
    /** Base64 of a PKCS#8 PEM. */
    privateKey: string;
}

/**
 * PKCS#8 specifically: the loader imports with `importPKCS8`, so a PKCS#1
 * `BEGIN RSA PRIVATE KEY` would generate cleanly here and then fail at boot.
 */
export function generateSigningKey(
    kid: string,
    bits = 2048,
): EncodedSigningKey {
    if (kid.trim() === '') {
        throw new Error('A signing key needs a non-empty kid');
    }

    const { privateKey } = generateKeyPairSync('rsa', {
        modulusLength: bits,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
    });

    return {
        kid: kid.trim(),
        privateKey: Buffer.from(privateKey).toString('base64'),
    };
}

/** Parse an existing `JWT_SIGNING_KEYS` value, accepting every form the loader does. */
export function decodeKeySet(encoded: string): EncodedSigningKey[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(decodeMaybeBase64(encoded));
    } catch (error) {
        throw new Error(
            'The existing JWT_SIGNING_KEYS is not valid JSON (or base64-encoded JSON)',
            { cause: error },
        );
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error(
            'The existing JWT_SIGNING_KEYS must be a non-empty JSON array',
        );
    }

    return parsed.map((entry, index) => {
        const candidate = entry as Partial<EncodedSigningKey>;
        if (
            typeof candidate.kid !== 'string' ||
            candidate.kid.trim() === '' ||
            typeof candidate.privateKey !== 'string'
        ) {
            throw new Error(
                `The existing JWT_SIGNING_KEYS[${index}] needs a non-empty "kid" and a "privateKey"`,
            );
        }
        if (
            !decodeMaybeBase64(candidate.privateKey).includes(
                PRIVATE_PEM_MARKER,
            )
        ) {
            throw new Error(
                `The existing JWT_SIGNING_KEYS[${index}] privateKey is not a PEM document`,
            );
        }
        return { kid: candidate.kid, privateKey: candidate.privateKey };
    });
}

/** The wire form: base64 of the JSON array, on one line. */
export function encodeKeySet(keys: EncodedSigningKey[]): string {
    return Buffer.from(JSON.stringify(keys)).toString('base64');
}

/**
 * Add a key to an existing set, keeping every key already there.
 *
 * A duplicate kid throws rather than replacing: two different keys under one
 * kid means tokens that verify or not depending on which copy the JWKS happens
 * to publish, which is far harder to diagnose than a refusal now.
 */
export function appendKey(
    existingEncoded: string | undefined,
    key: EncodedSigningKey,
): EncodedSigningKey[] {
    const existing =
        existingEncoded && existingEncoded.trim() !== ''
            ? decodeKeySet(existingEncoded)
            : [];

    if (existing.some((candidate) => candidate.kid === key.kid)) {
        throw new Error(
            `A key with kid "${key.kid}" is already in the set ` +
                `(${existing.map((candidate) => candidate.kid).join(', ')}). ` +
                'Pick a different kid — replacing a kid in place invalidates the tokens signed under it.',
        );
    }

    return [...existing, key];
}

/** The default kid: the month, which is the rotation cadence the docs assume. */
export function defaultKid(now: Date = new Date()): string {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
