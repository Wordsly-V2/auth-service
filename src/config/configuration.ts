const isProduction = (process.env.NODE_ENV ?? 'development') === 'production';

/**
 * Cookie `secure` flag.
 *
 * Defaults to ON in production instead of OFF everywhere. The old default meant
 * a deployment that simply never set REFRESH_TOKEN_COOKIE_SECURE shipped the
 * refresh token over plain HTTP, and nothing failed to warn about it. The env
 * var still wins where it is set, which is what local HTTP development needs.
 */
const refreshCookieSecure = (): boolean => {
    const configured = process.env.REFRESH_TOKEN_COOKIE_SECURE;
    if (configured === 'true') return true;
    if (configured === 'false') return false;
    return isProduction;
};

// Shared so the refresh cookie can default to the token's own lifetime. A
// function, not a constant: ConfigModule loads .env after this file is imported.
const refreshTokenExpiresIn = (): string =>
    process.env.JWT_REFRESH_TOKEN_EXPIRES_IN ?? '30d';

export default () => ({
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '3001', 10) ?? 3001,
    corsEnabledOrigins: process.env.CORS_ENABLED_ORIGINS,
    // The address browsers reach this service on, through the gateway. This is
    // the service's whole public identity: the `iss` claim on every token and
    // the base of the discovery document, so it must be the public URL and
    // never the in-cluster hostname. Verifiers compare `iss` exactly, so this
    // must equal the other services' JWT_ISSUER.
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000',
    // Hops between this service and the client. The gateway proxies to it, so
    // without this every request's IP is the gateway's and the refresh flow's
    // network-change logging becomes meaningless.
    trustProxyHops: parseInt(process.env.TRUST_PROXY_HOPS ?? '0', 10) || 0,
    database: {
        url: process.env.DATABASE_URL,
    },
    jwt: {
        signingKeys: process.env.JWT_SIGNING_KEYS,
        activeKid: process.env.JWT_ACTIVE_KID,
        audience: process.env.JWT_AUDIENCE ?? 'wordsly-api',
        refreshAudience: process.env.JWT_REFRESH_AUDIENCE ?? 'wordsly-auth',
        expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
        refreshTokenExpiresIn: refreshTokenExpiresIn(),
    },
    googleOAuth: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        redirectUri: process.env.GOOGLE_REDIRECT_URI,
        frontendRedirectUrl:
            process.env.GOOGLE_FRONTEND_REDIRECT_URL ??
            'http://localhost:4000/auth/redirect',
    },
    // 'cookie' keeps the refresh token in an httpOnly cookie; 'body' returns it
    // to the client, which cross-origin deployments need.
    refreshTokenDelivery: process.env.REFRESH_TOKEN_DELIVERY ?? 'cookie',
    // The only place these defaults live. AuthCookieService used to repeat every
    // fallback, so the effective value depended on which of the two you read.
    refreshTokenCookieOptions: {
        httpOnly: process.env.REFRESH_TOKEN_COOKIE_HTTP_ONLY !== 'false',
        secure: refreshCookieSecure(),
        // 'lax' keeps the cookie on the top-level redirect back from Google.
        // A cross-site deployment needs 'none', which browsers only accept
        // alongside secure -- hence the pairing check in validate-env.
        sameSite: process.env.REFRESH_TOKEN_COOKIE_SAME_SITE ?? 'lax',
        // Follows the refresh token's lifetime unless overridden. It used to
        // default to its own '30d', so shortening JWT_REFRESH_TOKEN_EXPIRES_IN
        // left browsers holding a cookie whose token had long since expired.
        maxAge:
            process.env.REFRESH_TOKEN_COOKIE_MAX_AGE ?? refreshTokenExpiresIn(),
        path: process.env.REFRESH_TOKEN_COOKIE_PATH ?? '/auth',
    },
    redis: {
        url: process.env.REDIS_URL,
    },
});
