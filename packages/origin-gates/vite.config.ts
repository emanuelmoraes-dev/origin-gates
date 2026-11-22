import { defineConfig } from 'vite';

export default defineConfig({
  // Consume/watch the package's public compiled entry; never alias its sources.
  optimizeDeps: { exclude: ['@origin-gates/narrative-engine'] },
});
