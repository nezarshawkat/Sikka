import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: {
    '@': fileURLToPath(new URL('./src', import.meta.url)),
    '@workspace/db': fileURLToPath(new URL('../../lib/db/src/index.ts', import.meta.url)),
    'drizzle-orm': fileURLToPath(new URL('../api-server/node_modules/drizzle-orm/index.js', import.meta.url)),
  } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
