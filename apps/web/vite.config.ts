import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    // Compile the shared Zod schemas from source so the browser validates with the exact API rules.
    alias: { '@evals/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) },
  },
  server: {
    port: Number(process.env.WEB_PORT ?? 5180),
    proxy: { '/api': `http://localhost:${process.env.PORT ?? 3001}` },
  },
});
