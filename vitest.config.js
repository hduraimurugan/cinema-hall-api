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
      reporter: ['text'],
      include: ['controllers/**', 'middleware/**', 'utils/**'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/generateTokenAndSetCookie.js',
        '**/oauthProviders.js',
      ],
      thresholds: {
        statements: 75,
        branches: 65,
        functions: 80,
        lines: 75,
      },
    },
    hookTimeout: 30000,
    testTimeout: 15000,
  },
})
