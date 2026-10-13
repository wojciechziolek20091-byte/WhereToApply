import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    // Stable file names so the bundle can be published next to a hand-written page.
    chunkSizeWarningLimit: 1500,
    rollupOptions: { output: { entryFileNames: 'assets/game.js', assetFileNames: 'assets/[name][extname]' } },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: true,
  },
});
