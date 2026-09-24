import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicKey, type KeyObject } from 'node:crypto';
import { exportJWK, importPKCS8, type JWK } from 'jose';

/**
 * The service's RSA signing keys, loaded once at boot.
 *
 * Keys live in the environment rather than the database on purpose. Rotation is
 * an ops event a handful of times a year, while signing is on the login critical
 * path — putting the keys in Postgres would mean no logins when the database is
 * unreachable, plus encryption-at-rest, key-generation endpoints and a bootstrap
 * path for "no keys yet". Env costs a restart per rotation and nothing else.
 *
 * Several keys may be loaded at once. Exactly one signs (`JWT_ACTIVE_KID`) while
 * every loaded key stays published in the JWKS, so tokens minted by the previous
 * key keep verifying for the rest of their lifetime. Rotation is therefore:
 * append the new key, flip `JWT_ACTIVE_KID`, restart, and drop the old key once
 * the longest-lived token issued under it has expired.
 */

export interface SigningKey {
    kid: string;
    privateKey: KeyObject;
    /**
     * Derived once at load. Verification uses this rather than the private key
     * so the private half is only ever handed to the signer.
     */
    publicKey: KeyObject;
}

interface RawSigningKey {
    kid?: unknown;
    privateKey?: unknown;
}

export const PRIVATE_PEM_MARKER = '-----BEGIN';

@Injectable()
export class SigningKeyService implements OnModuleInit {
    private readonly logger = new Logger(SigningKeyService.name);

    private keys: SigningKey[] = [];
    private activeKid = '';
    private publicJwks: { keys: JWK[] } = { keys: [] };

    constructor(private readonly configService: ConfigService) {}

    async onModuleInit(): Promise<void> {
        const configured = this.configService.get<string>('jwt.signingKeys');
        if (!configured) {
            throw new Error(
                'No JWT signing keys loaded. Set JWT_SIGNING_KEYS.',
            );
        }

        this.keys = await this.loadConfiguredKeys(configured);

        this.activeKid = this.resolveActiveKid();
        this.publicJwks = { keys: await this.buildPublicJwks() };

        this.logger.log(
            `Loaded ${this.keys.length} signing key(s); active kid=${this.activeKid}`,
        );
    }

    /** The key new tokens are signed with. */
    getActiveKey(): SigningKey {
        const key = this.keys.find(
            (candidate) => candidate.kid === this.activeKid,
        );
        if (!key) {
            throw new Error('Signing keys have not been initialised');
        }
        return key;
    }

    /** Look up a key by `kid` — used to verify this service's own tokens in-process. */
    getKeyByKid(kid: string | undefined): SigningKey | undefined {
        if (!kid) return undefined;
        return this.keys.find((candidate) => candidate.kid === kid);
    }

    /** Every public key, in JWKS form, for `/.well-known/jwks.json`. */
    getPublicJwks(): { keys: JWK[] } {
        return this.publicJwks;
    }

    private async loadConfiguredKeys(
        configured: string,
    ): Promise<SigningKey[]> {
        const raw = this.parseKeySet(configured);

        return Promise.all(
            raw.map(async (entry, index) => {
                if (typeof entry.kid !== 'string' || entry.kid.trim() === '') {
                    throw new Error(
                        `JWT_SIGNING_KEYS[${index}] is missing a non-empty "kid"`,
                    );
                }
                if (typeof entry.privateKey !== 'string') {
                    throw new Error(
                        `JWT_SIGNING_KEYS[${index}] is missing a "privateKey"`,
                    );
                }

                const pem = decodeMaybeBase64(entry.privateKey);
                if (!pem.includes(PRIVATE_PEM_MARKER)) {
                    throw new Error(
                        `JWT_SIGNING_KEYS[${index}] privateKey is not a PEM document`,
                    );
                }

                const privateKey = await importPKCS8<KeyObject>(pem, 'RS256', {
                    extractable: true,
                });

                return {
                    kid: entry.kid,
                    privateKey,
                    publicKey: createPublicKey(privateKey),
                };
            }),
        );
    }

    private parseKeySet(configured: string): RawSigningKey[] {
        let parsed: unknown;
        try {
            parsed = JSON.parse(decodeMaybeBase64(configured));
        } catch (error) {
            throw new Error(
                'JWT_SIGNING_KEYS is not valid JSON (or base64-encoded JSON)',
                { cause: error },
            );
        }

        if (!Array.isArray(parsed) || parsed.length === 0) {
            throw new Error('JWT_SIGNING_KEYS must be a non-empty JSON array');
        }
        return parsed as RawSigningKey[];
    }

    /**
     * A typo'd `JWT_ACTIVE_KID` must stop the boot, not silently fall through to
     * some other key: signing with a key nobody expected is far harder to
     * diagnose later than a refusal to start now.
     */
    private resolveActiveKid(): string {
        const configured = this.configService.get<string>('jwt.activeKid');
        if (!configured) return this.keys[0].kid;

        if (!this.keys.some((key) => key.kid === configured)) {
            throw new Error(
                `JWT_ACTIVE_KID "${configured}" is not among the loaded signing keys ` +
                    `(${this.keys.map((key) => key.kid).join(', ')})`,
            );
        }
        return configured;
    }

    private async buildPublicJwks(): Promise<JWK[]> {
        return Promise.all(
            this.keys.map(async (key) => ({
                ...(await exportJWK(key.publicKey)),
                kid: key.kid,
                use: 'sig',
                alg: 'RS256',
            })),
        );
    }
}

/**
 * Accept a PEM either raw or base64-wrapped.
 *
 * Multi-line PEMs survive poorly in `.env` files and compose `environment:`
 * blocks, so the documented form is base64. Raw is still accepted so existing
 * deployments keep working untouched.
 */
export function decodeMaybeBase64(value: string): string {
    const trimmed = value.trim();
    if (trimmed.includes(PRIVATE_PEM_MARKER) || trimmed.startsWith('[')) {
        return trimmed;
    }
    return Buffer.from(trimmed, 'base64').toString('utf8');
}
