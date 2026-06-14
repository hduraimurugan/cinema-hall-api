import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    fileParallelism: false,
    globalSetup: ['./tests/setup/globalSetup.js'],
    globalTeardown: ['./tests/setup/globalTeardown.js'],
    setupFiles: ['./tests/setup/env.js'],
    testMatch: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['controllers/**', 'middleware/**', 'utils/**'],
      exclude: ['node_modules/', 'tests/'],
    },
    hookTimeout: 30000,
    testTimeout: 15000,
  },
})
