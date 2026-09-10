import { defineConfig } from '@playwright/test'

export default defineConfig({
  // Single worker: the specs share one Electron instance and one temp
  // project root, so parallel workers race on both.
  workers: 1,
  testMatch: '**/*.spec.ts',
  // One retry in CI absorbs a transient flake (stalled dependency download,
  // slow runner) without hiding a real regression - a deterministic failure
  // fails twice and is still reported. Kept at 0 locally so the ~40s
  // iteration loop is unaffected.
  retries: process.env.CI ? 1 : 0,
  // HTML report gives a browsable per-test view. Uploaded by e2e.yml.
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    // Trace only retried tests: that is the flake case, the only case where
    // a trace earns its disk cost. A deterministic failure has an obvious
    // assertion, and the HTML report covers it.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  timeout: 30000
})
