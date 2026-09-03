/**
 * Generate a JWT signing key and print a paste-ready `JWT_SIGNING_KEYS` value.
 *
 *   npm run keys:generate                       # a fresh single-key set
 *   npm run keys:generate -- --append           # add to the set already in .env
 *   npm run keys:generate -- --append --kid 2026-10b --bits 4096
 *
 * Only the two env lines go to stdout, so the output can be piped; notes and the
 * rotation reminder go to stderr. Nothing is written to .env — rewriting a
 * secrets file in place is not something to do on someone's behalf.
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    appendKey,
    defaultKid,
    encodeKeySet,
    generateSigningKey,
} from '@/keys/signing-key.generator';

interface Options {
    kid: string;
    bits: number;
    append: boolean;
    envFile: string;
}

function parseArgs(argv: string[]): Options {
    const options: Options = {
        kid: defaultKid(),
        bits: 2048,
        append: false,
        envFile: '.env',
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const value = (): string => {
            const next = argv[index + 1];
            if (next === undefined || next.startsWith('--')) {
                throw new Error(`${arg} needs a value`);
            }
            index += 1;
            return next;
        };

        switch (arg) {
            case '--kid':
                options.kid = value();
                break;
            case '--bits':
                options.bits = Number(value());
                if (!Number.isInteger(options.bits) || options.bits < 2048) {
                    throw new Error(
                        '--bits must be an integer of at least 2048',
                    );
                }
                break;
            case '--append':
                options.append = true;
                break;
            case '--env-file':
                options.envFile = value();
                break;
            case '--help':
            case '-h':
                process.stderr.write(
                    'Usage: npm run keys:generate -- [--kid <kid>] [--bits 2048] [--append] [--env-file .env]\n',
                );
                process.exit(0);
                break;
            default:
                throw new Error(`Unknown argument "${arg}"`);
        }
    }

    return options;
}

/** The current set, read from the env file if it has one, else from the process env. */
function readExistingKeySet(envFile: string): string | undefined {
    const path = resolve(process.cwd(), envFile);
    if (existsSync(path)) {
        const parsed = loadDotenv({ path, processEnv: {}, quiet: true }).parsed;
        const fromFile = parsed?.JWT_SIGNING_KEYS;
        if (fromFile && fromFile.trim() !== '') return fromFile;
        process.stderr.write(
            `note: ${envFile} sets no JWT_SIGNING_KEYS; falling back to the process environment\n`,
        );
    } else {
        process.stderr.write(
            `note: ${envFile} not found; falling back to the process environment\n`,
        );
    }
    return process.env.JWT_SIGNING_KEYS;
}

function main(): void {
    const options = parseArgs(process.argv.slice(2));

    const existing = options.append
        ? readExistingKeySet(options.envFile)
        : undefined;

    const key = generateSigningKey(options.kid, options.bits);
    const keys = appendKey(existing, key);

    if (options.append && keys.length === 1) {
        process.stderr.write(
            'note: no existing key set was found, so this starts a fresh one\n',
        );
    }

    process.stderr.write(
        `\nGenerated a ${options.bits}-bit RSA key with kid "${key.kid}". ` +
            `The set now holds ${keys.length} key(s): ${keys.map((entry) => entry.kid).join(', ')}\n\n`,
    );

    process.stdout.write(`JWT_SIGNING_KEYS=${encodeKeySet(keys)}\n`);
    process.stdout.write(`JWT_ACTIVE_KID=${key.kid}\n`);

    if (keys.length > 1) {
        process.stderr.write(
            '\nRotating: paste both lines into your env, restart, and leave the older key(s)\n' +
                'in the set until the longest-lived token signed under them has expired — that is\n' +
                'JWT_REFRESH_TOKEN_EXPIRES_IN (30d by default), not JWT_EXPIRES_IN. Removing one\n' +
                'sooner signs out everyone still holding a token it signed.\n',
        );
    }
}

try {
    main();
} catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(1);
}
