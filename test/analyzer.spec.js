/*
 * Analyzer tests: load a fixture page, inject analyzer.js, assert on analyzePage().
 * Runs in plain Chromium (no extension needed).
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { ROOT } from '../scripts/build.mjs';

const ANALYZER = path.join(ROOT, 'analyzer.js');

async function analyze(page, url) {
    if (url) await page.goto(url);
    // Wait for images that are in the viewport (lazy ones below the fold or inside
    // fixture "hidden cases" — collapsed menus, off-canvas — never load).
    await page.waitForFunction(() => [...document.images]
        .filter((i) => i.getBoundingClientRect().top < innerHeight && !i.closest('[data-hidden-case]'))
        .every((i) => i.complete && i.naturalWidth > 0));
    await page.addScriptTag({ path: ANALYZER });
    return page.evaluate(() => analyzePage());
}

const messages = (r, level, section) => r.issues
    .filter((i) => (!level || i.level === level) && (!section || i.section === section))
    .map((i) => i.message);

test.describe('fixture.html (everything wrong)', () => {
    let r;
    test.beforeEach(async ({ page }) => { r = await analyze(page, '/test/fixtures/fixture.html'); });

    test('reports exactly the expected errors', () => {
        const errors = messages(r, 'error');
        expect(errors).toHaveLength(5);
        expect(errors).toEqual(expect.arrayContaining([
            'Missing meta description.',
            expect.stringMatching(/^Page is set to noindex/),
            'Missing og:image.',
            'No H1 found.',
            expect.stringMatching(/^JSON-LD block #2 is not valid JSON/),
        ]));
    });

    test('keeps page text literal (no HTML interpretation)', () => {
        expect(r.headings[0].text).toBe('Heading before H1 with "quotes" & bold <img src=x onerror=alert(1)>');
    });

    test('canonical with tracking params and hash still matches', () => {
        expect(r.meta.canonicalMatches).toBe(true);
    });

    test('heading outline flags', () => {
        expect(r.headings.map((h) => h.tag)).toEqual(['H2', 'H4', 'H3', 'H2']);
        expect(r.headings[1].skip).toBe(true);
        expect(r.headings[2].hidden).toBe(true);
        expect(r.headings[3].text).toBe('');
    });

    test('link classification', () => {
        const kinds = Object.fromEntries(['internal', 'external', 'anchor', 'js', 'empty', 'mailto', 'tel']
            .map((k) => [k, r.links.filter((l) => l.kind === k).length]));
        expect(kinds).toEqual({ internal: 3, external: 4, anchor: 1, js: 1, empty: 1, mailto: 1, tel: 1 });
        expect(r.links.find((l) => l.text === 'External, our origin in query').kind).toBe('external');
        expect(r.links.find((l) => l.text === 'Image link').text).toBe('Image link'); // from img alt
    });

    test('images: missing alt vs decorative', () => {
        expect(r.images.filter((i) => !i.hasAlt)).toHaveLength(1);
        expect(r.images.filter((i) => i.decorative)).toHaveLength(1);
    });

    test('schema: entities, invalid block, recommended props, @id references', () => {
        expect(r.schema.entityCount).toBe(4);
        expect(r.schema.jsonld[1].error).toBeTruthy();
        const article = r.schema.jsonld[0].entities.find((e) => e.type === 'Article');
        expect(article.missing).toEqual(['datePublished']);
        expect(r.schema.microdata[0].type).toBe('Product');
        expect(r.schema.microdata[0].data.offers.price).toBe('19.99');
        expect(r.schema.danglingRefs).toEqual(expect.arrayContaining([
            { id: '#webpage', sameSite: true },
            { id: 'https://example.com/#website', sameSite: false },
        ]));
        expect(r.schema.danglingRefs.find((x) => x.id === 'https://example.com/#org')).toBeUndefined();
    });

    test('hreflang without self-reference or x-default', () => {
        const warnings = messages(r, 'warning', 'meta');
        expect(warnings).toContain('Hreflang set has no self-referencing entry.');
        expect(warnings).toContain('Hreflang set has no x-default.');
    });
});

test('clean.html has no errors and no warnings', async ({ page }) => {
    const r = await analyze(page, '/test/fixtures/clean.html');
    expect(messages(r, 'error')).toEqual([]);
    expect(messages(r, 'warning')).toEqual([]);
    expect(r.meta.titlePx).toBeGreaterThan(200);
    expect(r.meta.titlePx).toBeLessThan(580);
    expect(r.content.source).toBe('main');
});

test('title width is measured in pixels, not characters', async ({ page }) => {
    await page.goto('/test/fixtures/clean.html');
    await page.evaluate(() => { document.title = 'W'.repeat(40); });
    const wide = await analyze(page);
    expect(wide.meta.titlePx).toBeGreaterThan(580);
    expect(messages(wide, 'warning', 'meta').some((m) => m.includes('Google truncates'))).toBe(true);

    await page.evaluate(() => { document.title = 'i'.repeat(40); });
    const narrow = await page.evaluate(() => analyzePage());
    expect(narrow.meta.titlePx).toBeLessThan(580);
    expect(messages(narrow, 'warning', 'meta').some((m) => m.includes('Google truncates'))).toBe(false);
});

test('image performance checks', async ({ page }) => {
    const r = await analyze(page, '/test/fixtures/images.html');
    const bySrc = (part) => r.images.find((i) => i.src.includes(part));
    const big = bySrc('1200x800');
    expect(big.oversized).toBeGreaterThanOrEqual(1.5);
    expect(big.lazy && big.aboveFold).toBe(true);
    expect(big.hasDims).toBe(false);
    const hero = bySrc('400x300');
    expect(hero.heavy).toBe(true);
    expect(hero.lcpCandidate).toBe(true);
    expect(bySrc('64x64').oversized).toBeNull();
    expect(bySrc('48x48').aboveFold).toBe(false);
    const warnings = messages(r, 'warning', 'images');
    expect(warnings).toEqual(expect.arrayContaining([
        expect.stringMatching(/larger than their displayed size/),
        expect.stringMatching(/over 300 KB/),
        expect.stringMatching(/lazy-loaded \(hurts LCP\)/),
    ]));
    expect(messages(r, 'info', 'images').some((m) => m.includes('fetchpriority'))).toBe(true);
});

test('images clipped by ancestors or off-screen are not "above the fold"', async ({ page }) => {
    const r = await analyze(page, '/test/fixtures/images.html');
    const bySrc = (part) => r.images.find((i) => i.src.includes(part));
    // Collapsed hover menu (max-height:0; overflow:hidden), off-canvas drawer, second carousel slide.
    for (const part of ['33x33', '34x34', '35x35', '201x100']) {
        expect(bySrc(part), part).toMatchObject({ hidden: true, aboveFold: false });
    }
    // Control: absolute image escapes a static overflow:hidden parent → visible.
    expect(bySrc('31x31')).toMatchObject({ hidden: false, aboveFold: true });
    // Control: positioned overflow:hidden parent clips its absolute child.
    expect(bySrc('32x32').hidden).toBe(true);
    // First carousel slide is visible.
    expect(bySrc('200x100')).toMatchObject({ hidden: false, aboveFold: true });
    // Only the genuinely visible lazy image (1200x800) is reported.
    expect(messages(r, 'warning', 'images')).toContain('1 above-the-fold image(s) are lazy-loaded (hurts LCP).');
    // Headings inside the collapsed menu are hidden too.
    expect(r.headings.find((h) => h.text === 'Menu heading').hidden).toBe(true);
});

test('content stats ignore navigation and count repeated terms', async ({ page }) => {
    await page.goto('/test/fixtures/clean.html');
    await page.setContent(`<!doctype html><html lang="en"><head><title>Coffee guide</title></head><body>
        <nav>menu menu menu menu menu menu</nav>
        <main><h1>Coffee guide</h1><p>${'Fresh coffee beans make great coffee. '.repeat(20)}</p></main>
        <footer>footer footer footer</footer></body></html>`);
    const r = await analyze(page);
    expect(r.content.wordCount).toBe(2 + 6 * 20);
    expect(r.content.keywords[0]).toMatchObject({ term: 'coffee', count: 41 });
    expect(r.content.keywords.find((k) => k.term === 'menu')).toBeUndefined();
    expect(r.content.phrases.map((p) => p.term)).toContain('coffee beans');
    expect(r.content.titleEqualsH1).toBe(true);
    expect(messages(r, 'info', 'content')).toEqual(expect.arrayContaining([expect.stringMatching(/^Thin content/), expect.stringMatching(/identical/)]));
});

test('hreflang validation', async ({ page }) => {
    const r = await analyze(page, '/test/fixtures/hreflang-en.html');
    const byLang = Object.fromEntries(r.meta.hreflang.map((x) => [x.lang, x]));
    expect(byLang.en.self).toBe(true);
    expect(byLang.english.valid).toBe(false);
    expect(byLang.de.relative).toBe(true);
    const warnings = messages(r, 'warning', 'meta');
    expect(warnings).toContain('Invalid hreflang code(s): english.');
    expect(warnings).toContain('Hreflang set has no x-default.');
    expect(warnings).not.toContain('Hreflang set has no self-referencing entry.');
});

test('analyzer can be injected twice into the same page', async ({ page }) => {
    await analyze(page, '/test/fixtures/clean.html');
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addScriptTag({ path: ANALYZER });
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => typeof analyzePage)).toBe('function');
});
