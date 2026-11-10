/*
 * End-to-end tests: load the staged extension (exactly the shipped files) into
 * Chromium and drive the background worker, badge and popup.
 * The popup is opened as a tab via popup.html?tabId=<id>.
 */
import { test as base, chromium, expect } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { stage } from '../scripts/build.mjs';

const BASE = 'http://localhost:8765';
let extDir;

const test = base.extend({
    // eslint-disable-next-line no-empty-pattern
    context: async ({}, use) => {
        const context = await chromium.launchPersistentContext('', {
            channel: 'chromium',
            args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
            acceptDownloads: true,
        });
        await use(context);
        await context.close();
    },
    sw: async ({ context }, use) => {
        let [sw] = context.serviceWorkers();
        if (!sw) sw = await context.waitForEvent('serviceworker');
        // Right after launch, the first navigation can beat the worker's webRequest
        // listeners (the popup then falls back to re-fetching). Warm up until a
        // navigation is captured so tests are deterministic.
        const warm = await context.newPage();
        await expect.poll(async () => {
            await warm.goto(`${BASE}/status/204`).catch(() => {});
            const all = await sw.evaluate(() => chrome.storage.session.get(null));
            return Object.values(all).some((t) => t.nav?.url?.endsWith('/status/204'));
        }, { timeout: 15_000 }).toBe(true);
        await warm.close();
        await use(sw);
    },
    extensionId: async ({ sw }, use) => { await use(new URL(sw.url()).host); },
});

test.beforeAll(async () => {
    extDir = await stage(path.join(os.tmpdir(), `htmlseo-ext-${process.pid}`));
});

async function tabIdOf(sw, page) {
    const url = page.url();
    return sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, url);
}

const badgeOf = (sw, tabId) => sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);

async function openPopup(context, extensionId, tabId) {
    const popup = await context.newPage();
    const errors = [];
    popup.on('pageerror', (e) => errors.push(e.message));
    await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${tabId}`);
    await expect(popup.locator('#page-title')).not.toHaveText('Analyzing…');
    popup.errors = errors;
    return popup;
}

async function waitForServerChecks(popup) {
    await popup.locator('.rail-btn[data-tab="indexing"]').click();
    await expect(popup.locator('#view')).not.toContainText('Checking…', { timeout: 15_000 });
}

test('badge shows the error count and clears on a clean page', async ({ context, sw }) => {
    const page = await context.newPage();
    await page.goto(`${BASE}/test/fixtures/fixture.html`);
    const tabId = await tabIdOf(sw, page);
    await expect.poll(() => badgeOf(sw, tabId)).toBe('5');
    await page.goto(`${BASE}/test/fixtures/clean.html`);
    await expect.poll(() => badgeOf(sw, tabId)).toBe('');
});

test('turning off the auto badge clears it', async ({ context, sw }) => {
    const page = await context.newPage();
    await page.goto(`${BASE}/test/fixtures/fixture.html`);
    const tabId = await tabIdOf(sw, page);
    await expect.poll(() => badgeOf(sw, tabId)).toBe('5');
    await sw.evaluate(() => chrome.storage.sync.set({ autoBadge: false }));
    await expect.poll(() => badgeOf(sw, tabId)).toBe('');
    await page.reload();
    await page.waitForTimeout(1000);
    expect(await badgeOf(sw, tabId)).toBe('');
});

test('X-Robots-Tag noindex header counts as an error and shows in Indexing', async ({ context, sw, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${BASE}/xrobots-noindex`);
    const tabId = await tabIdOf(sw, page);
    await expect.poll(() => badgeOf(sw, tabId)).toBe('1');
    const popup = await openPopup(context, extensionId, tabId);
    await waitForServerChecks(popup);
    await expect(popup.locator('.verdict')).toContainText('Not indexable');
    await expect(popup.locator('.verdict')).toContainText('X-Robots-Tag noindex');
    await expect(popup.locator('#view')).toContainText('from page load');
    expect(popup.errors).toEqual([]);
});

test('redirect chain is captured from the real navigation', async ({ context, sw, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${BASE}/redirect-301`);
    expect(page.url()).toBe(`${BASE}/test/fixtures/clean.html`);
    const tabId = await tabIdOf(sw, page);
    const popup = await openPopup(context, extensionId, tabId);
    await waitForServerChecks(popup);
    const steps = popup.locator('.steps .step');
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(0)).toContainText('301');
    await expect(steps.nth(1)).toContainText('302');
    await expect(steps.nth(2)).toContainText('200');
});

test('robots.txt disallow is detected', async ({ context, sw, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${BASE}/test/fixtures/blocked.html`);
    const popup = await openPopup(context, extensionId, await tabIdOf(sw, page));
    await waitForServerChecks(popup);
    await expect(popup.locator('.verdict')).toContainText('blocked by robots.txt');
    await expect(popup.locator('#view')).toContainText('Disallow: /test/fixtures/blocked');
});

test('link checker marks broken links', async ({ context, sw, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${BASE}/test/fixtures/fixture.html`);
    const popup = await openPopup(context, extensionId, await tabIdOf(sw, page));
    await popup.evaluate(() => chrome.storage.sync.set({ linkCheckLimit: 10 }));
    await popup.locator('.rail-btn[data-tab="links"]').click();
    await popup.getByRole('button', { name: 'Check links' }).click();
    await expect(popup.locator('.progress-text')).toContainText('Checked', { timeout: 30_000 });
    const brokenRow = popup.locator('.item', { hasText: 'Broken internal link' });
    await expect(brokenRow.locator('.chip.err')).toHaveText('404');
    const okRow = popup.locator('.item', { hasText: 'Working internal link' });
    await expect(okRow.locator('.chip.ok')).toHaveText('200');
});

test('overlay can be toggled on and off', async ({ context, sw, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${BASE}/test/fixtures/fixture.html`);
    const popup = await openPopup(context, extensionId, await tabIdOf(sw, page));
    await popup.locator('.rail-btn[data-tab="headings"]').click();
    const toggle = popup.getByRole('button', { name: 'Show on page' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('htmlseo-overlay')).toHaveCount(1);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('htmlseo-overlay')).toHaveCount(0);
});

test('overlay skips images hidden in a collapsed menu', async ({ context, sw, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${BASE}/test/fixtures/images.html`);
    const popup = await openPopup(context, extensionId, await tabIdOf(sw, page));
    await popup.locator('.rail-btn[data-tab="images"]').click();
    await popup.getByRole('button', { name: 'Highlight alt on page' }).click();
    // 4 images lack alt: 2 in the collapsed menu + 1 clipped control are invisible; only #escape is drawn.
    await expect(page.locator('htmlseo-overlay')).toHaveAttribute('data-count', '1');
});

test('SPA route change re-analyzes the open popup', async ({ context, sw, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${BASE}/test/fixtures/spa.html`);
    const popup = await openPopup(context, extensionId, await tabIdOf(sw, page));
    await expect(popup.locator('#page-title')).toHaveText('SPA home');
    await page.click('#go-about');
    await expect(popup.locator('#page-title')).toHaveText('SPA about', { timeout: 10_000 });
    await expect(popup.locator('#page-url')).toContainText('?route=about');
});

test('plain #anchor jumps do not trigger re-analysis', async ({ context, sw, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${BASE}/test/fixtures/spa.html`);
    const popup = await openPopup(context, extensionId, await tabIdOf(sw, page));
    await page.click('#go-anchor');
    await page.waitForTimeout(2000);
    await expect(popup.locator('#page-url')).not.toContainText('#section');
});

test('export downloads a Markdown report', async ({ context, sw, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${BASE}/test/fixtures/fixture.html`);
    const popup = await openPopup(context, extensionId, await tabIdOf(sw, page));
    await popup.locator('#export-btn').click();
    const [download] = await Promise.all([popup.waitForEvent('download'), popup.getByRole('menuitem', { name: 'Download .md' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^seo-localhost_8765-\d{4}-\d{2}-\d{2}\.md$/);
    const md = await readFile(await download.path(), 'utf8');
    expect(md).toContain('# SEO report: Fixture page');
    expect(md).toContain('## Issues');
    expect(md).toContain('**error** (headings) No H1 found.');
});

test('every view renders without errors', async ({ context, sw, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${BASE}/test/fixtures/fixture.html`);
    const popup = await openPopup(context, extensionId, await tabIdOf(sw, page));
    for (const tab of ['overview', 'meta', 'content', 'headings', 'images', 'links', 'schema', 'indexing']) {
        await popup.locator(`.rail-btn[data-tab="${tab}"]`).click();
        await expect(popup.locator('.rail-btn[aria-current="page"]')).toHaveAttribute('data-tab', tab);
        await expect(popup.locator('#view .card').first()).toBeVisible();
        // Page text must never be rendered as markup.
        expect(await popup.locator('#view img[src="x"]').count()).toBe(0);
    }
    await popup.locator('#settings-btn').click();
    await expect(popup.locator('#view')).toContainText('Show error badge automatically');
    expect(popup.errors).toEqual([]);
});

test('pages Chrome forbids show a friendly message', async ({ context, sw, extensionId }) => {
    const page = await context.newPage();
    await page.goto('chrome://version');
    // chrome:// URLs are hidden from extensions, so take the active tab instead.
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id);
    const popup = await openPopup(context, extensionId, tabId);
    await expect(popup.locator('#view')).toContainText('This page can’t be analyzed');
});

test('hreflang return links are verified', async ({ context, sw, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${BASE}/test/fixtures/hreflang-en.html`);
    const popup = await openPopup(context, extensionId, await tabIdOf(sw, page));
    await popup.locator('.rail-btn[data-tab="meta"]').click();
    await popup.getByRole('button', { name: 'Check return links' }).click();
    const card = popup.locator('.card').filter({ has: popup.locator('h2.card-title', { hasText: /^Hreflang$/ }) });
    const row = (lang) => card.locator('.kv').filter({ has: popup.locator('.kv-key', { hasText: new RegExp(`^${lang}$`) }) });
    await expect(row('de')).toContainText('links back as en');
    await expect(row('fr')).toContainText('HTTP 404');
    await expect(row('en')).toContainText('this page');
    await expect(row('english')).toContainText('invalid code');
});
