export default () => ({
  port: parseInt(process.env.PORT ?? '3001', 10) ?? 3001,
  internalServiceToServiceToken: process.env.INTERNAL_SERVICE_TO_SERVICE_TOKEN,
  database: {
    url: process.env.DATABASE_URL,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
    refreshTokenExpiresIn: process.env.JWT_REFRESH_TOKEN_EXPIRES_IN ?? '30d',
  },
});
