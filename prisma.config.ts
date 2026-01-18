// prisma.config.ts
import { defineConfig, env } from 'prisma/config';
import 'dotenv/config'; // Import dotenv to load .env file manually

export default defineConfig({
  // ... other config (schema path, migrations path)
  datasource: {
    url: env('DATABASE_URL'), // or process.env.DATABASE_URL
  },
});
