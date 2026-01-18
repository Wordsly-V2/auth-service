export default () => ({
  tcp: {
    port: parseInt(process.env.TCP_PORT ?? '3002', 10) ?? 3002,
  },
  database: {
    url: process.env.DATABASE_URL,
  },
});
