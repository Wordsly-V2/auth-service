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

/**
 * Durations handed to jose's `setExpirationTime` (the JWT lifetimes) and to
 * `ms()` (the refresh row's expiry and the cookie's maxAge). This is the subset
 * both parse identically: a number *with* a unit. A bare number is refused on
 * purpose -- jose throws on it at the first login, while `ms()` reads it as
 * milliseconds, so '900' would make a cookie that expires before it arrives.
 */
const DURATION_ENV_VARS = [
    'JWT_EXPIRES_IN',
    'JWT_REFRESH_TOKEN_EXPIRES_IN',
    'REFRESH_TOKEN_COOKIE_MAX_AGE',
] as const;

const DURATION_PATTERN =
    /^\d+(\.\d+)? ?(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)$/i;

const REFRESH_TOKEN_DELIVERY_MODES = ['cookie', 'body'];

// Must match the fallbacks in configuration.ts: the collision check compares the
// values the service will actually use, not just the ones that were set.
const DEFAULT_JWT_AUDIENCE = 'wordsly-api';
const DEFAULT_JWT_REFRESH_AUDIENCE = 'wordsly-auth';

function isBlank(value: string | undefined): boolean {
    return !value || value.trim() === '';
}

export function validateEnv(
    config: Record<string, unknown>,
): Record<string, unknown> {
    // Everything here comes from process.env and .env files, so it is a string.
    const env = config as Record<string, string | undefined>;
    const missing = REQUIRED_ENV_VARS.filter((key) => isBlank(env[key]));

    if (missing.length > 0) {
        throw new Error(
            `Missing required environment variables: ${missing.join(', ')}`,
        );
    }

    // Browsers silently drop a SameSite=None cookie that is not also Secure, so
    // this combination does not fail loudly at runtime — it just means nobody
    // can stay signed in, with no error anywhere to explain why.
    const sameSite = (env.REFRESH_TOKEN_COOKIE_SAME_SITE ?? '').toLowerCase();
    if (sameSite === 'none' && env.REFRESH_TOKEN_COOKIE_SECURE === 'false') {
        throw new Error(
            'REFRESH_TOKEN_COOKIE_SAME_SITE=none requires ' +
                'REFRESH_TOKEN_COOKIE_SECURE to be true: browsers reject a ' +
                'SameSite=None cookie that is not Secure.',
        );
    }

    // The audience is what stops a refresh token being accepted as an access
    // token (and vice versa). Equal audiences leave only the `typ` claim holding
    // that line, and nothing would fail to show it had gone.
    const audience = env.JWT_AUDIENCE ?? DEFAULT_JWT_AUDIENCE;
    const refreshAudience =
        env.JWT_REFRESH_AUDIENCE ?? DEFAULT_JWT_REFRESH_AUDIENCE;
    if (audience === refreshAudience) {
        throw new Error(
            'JWT_AUDIENCE and JWT_REFRESH_AUDIENCE must differ: the audience ' +
                'is what keeps a refresh token from being used as an access ' +
                `token (both are "${audience}").`,
        );
    }

    // Anything but 'body' silently means cookie delivery, so a typo like
    // 'Body' would ship the wrong mode rather than fail.
    const delivery = env.REFRESH_TOKEN_DELIVERY;
    if (
        delivery !== undefined &&
        !REFRESH_TOKEN_DELIVERY_MODES.includes(delivery)
    ) {
        throw new Error(
            `REFRESH_TOKEN_DELIVERY must be one of ` +
                `${REFRESH_TOKEN_DELIVERY_MODES.join(', ')} (got "${delivery}").`,
        );
    }

    // Unset falls back to a default; set-but-malformed would otherwise only
    // surface at the first login or refresh, as a 500 rather than a boot failure.
    const badDurations = DURATION_ENV_VARS.filter(
        (key) => env[key] !== undefined && !DURATION_PATTERN.test(env[key]),
    );
    if (badDurations.length > 0) {
        throw new Error(
            `Invalid duration in ${badDurations.join(', ')}: expected a ` +
                "number with a unit, such as '15m', '12h' or '30d'.",
        );
    }

    return config;
}
