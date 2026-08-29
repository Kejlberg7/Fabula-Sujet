import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: { url: process.env.FS_DATABASE_URL ?? './fabula.db' },
} satisfies Config;
