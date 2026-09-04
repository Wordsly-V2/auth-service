/**
 * Fail-fast validation of required environment variables at boot.
 * Wired into ConfigModule.forRoot({ validate }). Throwing here aborts startup
 * instead of letting the service run with missing/insecure defaults.
 */
const REQUIRED_ENV_VARS = [
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

    return config;
}
