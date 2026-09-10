/**
 * Fail-fast validation of required environment variables at boot.
 * Wired into ConfigModule.forRoot({ validate }). Throwing here aborts startup
 * instead of letting the service run with missing/insecure defaults.
 */
const REQUIRED_ENV_VARS = [
    // Required, not optional: an empty value used to make buildCorsOptions
    // return undefined and the caller skip enableCors entirely, silently
    // disabling CORS instead of locking it down.
    'CORS_ENABLED_ORIGINS',
    'JWT_SIGNING_KEYS',
    'DATABASE_URL',
    'REDIS_URL',
    'PUBLIC_BASE_URL',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI',
] as const;

function isBlank(value: unknown): boolean {
    return !value || String(value).trim() === '';
}

export function validateEnv(
    config: Record<string, unknown>,
): Record<string, unknown> {
    const missing = REQUIRED_ENV_VARS.filter((key) => isBlank(config[key]));

    if (missing.length > 0) {
        throw new Error(
            `Missing required environment variables: ${missing.join(', ')}`,
        );
    }

    // Browsers silently drop a SameSite=None cookie that is not also Secure, so
    // this combination does not fail loudly at runtime — it just means nobody
    // can stay signed in, with no error anywhere to explain why.
    const sameSite = String(
        config.REFRESH_TOKEN_COOKIE_SAME_SITE ?? '',
    ).toLowerCase();
    if (sameSite === 'none' && config.REFRESH_TOKEN_COOKIE_SECURE === 'false') {
        throw new Error(
            'REFRESH_TOKEN_COOKIE_SAME_SITE=none requires ' +
                'REFRESH_TOKEN_COOKIE_SECURE to be true: browsers reject a ' +
                'SameSite=None cookie that is not Secure.',
        );
    }

    return config;
}
