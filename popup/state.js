/*
 * state.js — popup state, settings and navigation.
 * Views import from here; main.js registers the render function.
 */

export const TABS = ['overview', 'meta', 'content', 'headings', 'images', 'links', 'schema', 'indexing', 'settings'];
const TAB_KEY = 'htmlseo.tab';

export const DEFAULT_SETTINGS = {
    autoBadge: true,
    spaReanalyze: true,
    linkCheckLimit: 300,
    linkCheckConcurrency: 6,
};

export const state = {
    tabId: null,
    data: null, // analyzer result
    server: null, // { status: 'loading'|'done'|'error', nav, source, ... }
    robots: null, // { status, ... } robots.txt result
    sitemap: null, // sitemap result
    linkCheck: null, // { running, done, total, results: {url: result}, controller }
    hreflangCheck: null, // { running, results: {href: result} }
    ogImageSize: null, // { width, height } | { error }
    overlay: [], // active overlay modes in the page
    pageChanged: false, // SPA route changed while popup open (when auto re-analyze is off)
    tab: loadTab(),
    filters: { images: 'all', links: 'all' },
    settings: { ...DEFAULT_SETTINGS },
};

function loadTab() {
    try {
        const t = localStorage.getItem(TAB_KEY);
        return TABS.includes(t) ? t : 'overview';
    } catch {
        return 'overview';
    }
}

let renderFn = () => {};
export function setRenderer(fn) {
    renderFn = fn;
}

let pending = 0;
/* Re-render now, or throttled (for progress updates). */
export function rerender(throttle = false) {
    if (!throttle) { renderFn(); return; }
    if (pending) return;
    pending = setTimeout(() => { pending = 0; renderFn(); }, 200);
}

export function go(tab) {
    if (!TABS.includes(tab)) return;
    state.tab = tab;
    if (tab !== 'settings') {
        try { localStorage.setItem(TAB_KEY, tab); } catch { /* ignore */ }
    }
    rerender();
}

export async function loadSettings() {
    try {
        state.settings = { ...DEFAULT_SETTINGS, ...(await chrome.storage.sync.get(DEFAULT_SETTINGS)) };
    } catch {
        state.settings = { ...DEFAULT_SETTINGS };
    }
}

export async function saveSetting(key, value) {
    state.settings[key] = value;
    try { await chrome.storage.sync.set({ [key]: value }); } catch { /* ignore */ }
}

/* Issues from the analyzer plus popup-side checks (server, robots.txt, sitemap). */
export function allIssues() {
    if (!state.data) return [];
    return [...state.data.issues, ...serverIssues()];
}

export function issuesFor(section, level) {
    return allIssues().filter((i) => (!section || i.section === section) && (!level || i.level === level));
}

export function serverIssues() {
    const out = [];
    const add = (level, message) => out.push({ level, section: 'indexing', message });
    const s = state.server;
    if (s?.status === 'done') {
        if (s.error) add('warning', `Could not check the HTTP response: ${s.error}`);
        else {
            if (s.httpStatus >= 400) add('error', `Page responds with HTTP ${s.httpStatus}.`);
            if (/\b(noindex|none)\b/i.test(s.headers?.['x-robots-tag'] || '')) add('error', `X-Robots-Tag header: ${s.headers['x-robots-tag']}.`);
            if (s.chain?.length > 1) add('warning', `Redirect chain with ${s.chain.length} hops.`);
            else if (s.chain?.length === 1) add('info', `Page was reached through a ${s.chain[0].statusCode} redirect.`);
        }
    }
    const r = state.robots;
    if (r?.status === 'done') {
        if (r.httpStatus >= 500) add('warning', `robots.txt responds with HTTP ${r.httpStatus} (Google may stop crawling).`);
        if (r.verdict && !r.verdict.allowed) add('error', `Blocked by robots.txt (${r.verdict.rule.type}: ${r.verdict.rule.pattern}).`);
        if (!r.sitemaps?.length) add('info', 'robots.txt lists no Sitemap.');
    }
    const sm = state.sitemap;
    if (sm?.status === 'done') {
        if (sm.httpStatus >= 400 && !sm.guessed) add('warning', `Sitemap ${sm.url} responds with HTTP ${sm.httpStatus}.`);
        else if (sm.httpStatus >= 400) { /* no /sitemap.xml and none listed — already reported via robots.txt */ }
        else if (sm.found === false && !sm.isIndex) add('info', 'Page URL was not found in the sitemap.');
    }
    return out;
}
