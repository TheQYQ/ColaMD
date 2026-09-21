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
  // 10 s instead of Playwright's 5 s default. The suite is single-worker by
  // necessity (one Electron instance, one temp project root), so every spec
  // queues behind the ones before it and the machine is busy the whole time.
  // Three specs have been observed failing on a *poll* of a value that is
  // already on its way there — the status-bar word counter
  // (editor-input.spec.ts:144, `Expected: 9 / Received: 7`), the live outline
  // node (toc-panel-content.spec.ts:152) and the per-tab undo stack
  // (tab-switch-cursor.spec.ts:157) — each green when re-run alone. A
  // deterministic failure still fails; it just spends 10 s doing it, and the
  // 30 s test cap below is unchanged.
  expect: { timeout: 10000 },
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
