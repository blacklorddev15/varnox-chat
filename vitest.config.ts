import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The test runner.
 *
 * Only `tests/` is collected. tsconfig.json's `include` is wide on purpose — Next.js type-checks
 * everything under the app — but a test file being type-checked is not the same as it being run,
 * and a build should never execute one.
 */
export default defineConfig({
  resolve: {
    // Mirrors the `@/*` path in tsconfig.json so a test can import the way the app does. The
    // modules under test use relative paths internally, so nothing depends on this yet; it is
    // here so that a test importing '@/lib/bots' works rather than failing in a way that looks
    // like a missing file.
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    /**
     * One file at a time. The database tests share a single Postgres database and clean up the
     * rows they wrote; running them alongside each other would let one file's cleanup delete
     * another's fixtures, which fails as a flake rather than as a bug.
     */
    fileParallelism: false,
    // A database round trip over a pooled connection is slower than a unit test's budget, and a
    // cold first connection on CI local Postgres can take a moment.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
