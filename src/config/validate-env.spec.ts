import { validateEnv } from '@/config/validate-env';

/**
 * Each of these used to boot fine and fail later, somewhere less obvious: equal
 * audiences quietly weakened the access/refresh split, a delivery typo silently
 * meant cookie mode, and a malformed duration only threw at the first login.
 */
describe('validateEnv', () => {
    const base = (): Record<string, unknown> => ({
        CORS_ENABLED_ORIGINS: 'http://localhost:4000',
        JWT_SIGNING_KEYS: 'keys',
        DATABASE_URL: 'postgres://x',
        REDIS_URL: 'redis://x',
        PUBLIC_BASE_URL: 'http://localhost:3000',
        GOOGLE_CLIENT_ID: 'id',
        GOOGLE_CLIENT_SECRET: 'secret',
        GOOGLE_REDIRECT_URI: 'http://localhost:3000/auth/google/redirect',
    });

    it('accepts a minimal config, relying on the defaults', () => {
        expect(() => validateEnv(base())).not.toThrow();
    });

    it('reports missing required variables', () => {
        const config = base();
        delete config.DATABASE_URL;
        expect(() => validateEnv(config)).toThrow(/DATABASE_URL/);
    });

    describe('audiences', () => {
        it('rejects equal access and refresh audiences', () => {
            expect(() =>
                validateEnv({
                    ...base(),
                    JWT_AUDIENCE: 'same',
                    JWT_REFRESH_AUDIENCE: 'same',
                }),
            ).toThrow(/JWT_AUDIENCE and JWT_REFRESH_AUDIENCE must differ/);
        });

        it('compares against the defaults when only one side is set', () => {
            // The refresh audience defaults to 'wordsly-auth'.
            expect(() =>
                validateEnv({ ...base(), JWT_AUDIENCE: 'wordsly-auth' }),
            ).toThrow(/must differ/);
        });

        it('accepts distinct audiences', () => {
            expect(() =>
                validateEnv({
                    ...base(),
                    JWT_AUDIENCE: 'api',
                    JWT_REFRESH_AUDIENCE: 'auth',
                }),
            ).not.toThrow();
        });
    });

    describe('REFRESH_TOKEN_DELIVERY', () => {
        it.each(['cookie', 'body'])('accepts %s', (mode) => {
            expect(() =>
                validateEnv({ ...base(), REFRESH_TOKEN_DELIVERY: mode }),
            ).not.toThrow();
        });

        it.each(['Body', 'header', ''])('rejects "%s"', (mode) => {
            expect(() =>
                validateEnv({ ...base(), REFRESH_TOKEN_DELIVERY: mode }),
            ).toThrow(/REFRESH_TOKEN_DELIVERY must be one of/);
        });
    });

    describe('durations', () => {
        const keys = [
            'JWT_EXPIRES_IN',
            'JWT_REFRESH_TOKEN_EXPIRES_IN',
            'REFRESH_TOKEN_COOKIE_MAX_AGE',
        ];

        it.each(keys)('accepts a duration with a unit in %s', (key) => {
            for (const value of ['15m', '12h', '30d', '1 week', '90s']) {
                expect(() =>
                    validateEnv({ ...base(), [key]: value }),
                ).not.toThrow();
            }
        });

        it.each(keys)('rejects a malformed or unitless %s', (key) => {
            // '900' is the dangerous one: ms() would read it as milliseconds.
            for (const value of ['900', 'thirty days', '', '15 minutes ago']) {
                expect(() => validateEnv({ ...base(), [key]: value })).toThrow(
                    new RegExp(`Invalid duration in ${key}`),
                );
            }
        });
    });

    it('keeps the SameSite=None requires Secure check', () => {
        expect(() =>
            validateEnv({
                ...base(),
                REFRESH_TOKEN_COOKIE_SAME_SITE: 'none',
                REFRESH_TOKEN_COOKIE_SECURE: 'false',
            }),
        ).toThrow(/requires/);
    });
});
