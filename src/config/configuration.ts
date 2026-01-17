export default () => ({
  port: parseInt(process.env.PORT ?? '3001', 10) ?? 3001,
  tcp: {
    port: parseInt(process.env.TCP_PORT ?? '3002', 10) ?? 3002,
  },
});
