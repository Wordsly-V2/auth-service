export default () => ({
  tcp: {
    port: parseInt(process.env.TCP_PORT ?? '3002', 10) ?? 3002,
  },
  database: {
    url: process.env.DATABASE_URL,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
    refreshTokenExpiresIn: process.env.JWT_REFRESH_TOKEN_EXPIRES_IN ?? '30d',
  },
});
