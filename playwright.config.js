import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: 'test',
    testMatch: /.*\.spec\.js$/,
    timeout: 45_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    workers: 1, // extension tests share one test server and are stateful per context
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: 'http://localhost:8765',
        trace: 'retain-on-failure',
    },
    webServer: {
        command: 'node test/server.mjs',
        url: 'http://localhost:8765/robots.txt',
        reuseExistingServer: !process.env.CI,
    },
});
