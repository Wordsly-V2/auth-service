export default () => ({
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
        refreshTokenExpiresIn:
            process.env.JWT_REFRESH_TOKEN_EXPIRES_IN ?? '30d',
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
    refreshTokenCookieOptions: {
        httpOnly: process.env.REFRESH_TOKEN_COOKIE_HTTP_ONLY !== 'false',
        secure: process.env.REFRESH_TOKEN_COOKIE_SECURE === 'true',
        sameSite: process.env.REFRESH_TOKEN_COOKIE_SAME_SITE ?? 'lax',
        maxAge: process.env.REFRESH_TOKEN_COOKIE_MAX_AGE ?? '30d',
        path: process.env.REFRESH_TOKEN_COOKIE_PATH ?? '/auth',
    },
    redis: {
        url: process.env.REDIS_URL,
    },
});
