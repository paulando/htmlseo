/*
 * background.js — MV3 service worker.
 *
 * 1. Navigation capture (webRequest, observe-only): for each tab's main-frame load,
 *    records the redirect chain, final status and SEO-relevant response headers
 *    (X-Robots-Tag, Link, …) in chrome.storage.session under "tab:<id>".nav.
 *    The popup's Indexing tab reads it. (The worker can be killed at any time, so
 *    state lives in storage.session, not in variables.)
 * 2. Badge: text = popup override ?? (page errors from content.js + server errors).
 *    With settings.autoBadge off, only a popup analysis sets the badge.
 */

const DEFAULT_SETTINGS = { autoBadge: true };
const tabKey = (tabId) => `tab:${tabId}`;

chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
chrome.action.setBadgeTextColor?.({ color: '#FFFFFF' });

/* ---------------------------------------------------------- per-tab state */

// Serialize read-modify-write per tab so rapid webRequest events don't clobber each other.
const queues = new Map();

async function readTab(tabId) {
    const key = tabKey(tabId);
    return (await chrome.storage.session.get(key))[key] || {};
}

function updateTab(tabId, fn) {
    const run = (queues.get(tabId) || Promise.resolve()).then(async () => {
        const next = fn(await readTab(tabId));
        if (next) await chrome.storage.session.set({ [tabKey(tabId)]: next });
        return next;
    });
    queues.set(tabId, run.catch(() => {}));
    return run;
}

/* ------------------------------------------------------------------ badge */

function serverErrors(nav) {
    if (!nav || nav.error || !nav.status) return 0;
    let n = 0;
    if (nav.status >= 400) n++;
    if (/\b(noindex|none)\b/i.test(nav.headers?.['x-robots-tag'] || '')) n++;
    return n;
}

async function refreshBadge(tabId) {
    const [{ autoBadge }, t] = await Promise.all([chrome.storage.sync.get(DEFAULT_SETTINGS), readTab(tabId)]);
    let count = 0;
    if (t.override != null) count = t.override;
    else if (autoBadge) count = (t.page || 0) + serverErrors(t.nav);
    await chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : '' }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === 'updateCount' && sender.tab?.id != null) {
        // From content.js (initial load or SPA route change). Replaces any popup override.
        const tabId = sender.tab.id;
        updateTab(tabId, (t) => ({ ...t, page: message.count, override: null })).then(() => refreshBadge(tabId));
    } else if (message?.type === 'popupCount' && message.tabId != null) {
        // From the popup after a full analysis (includes robots.txt etc.).
        updateTab(message.tabId, (t) => ({ ...t, override: message.count })).then(() => refreshBadge(message.tabId));
    }
});

chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'sync' || !changes.autoBadge) return;
    const tabs = await chrome.tabs.query({});
    tabs.forEach((tab) => refreshBadge(tab.id));
});

chrome.tabs.onRemoved.addListener((tabId) => {
    queues.delete(tabId);
    chrome.storage.session.remove(tabKey(tabId));
});

/* ------------------------------------------------------- navigation capture */

const MAIN_FRAME = { urls: ['<all_urls>'], types: ['main_frame'] };
const KEEP_HEADERS = ['x-robots-tag', 'link', 'content-type', 'last-modified', 'cache-control', 'content-language', 'location', 'server'];

chrome.webRequest.onBeforeRequest.addListener((d) => {
    if (d.tabId < 0) return;
    updateTab(d.tabId, (t) => {
        // Redirect hops fire onBeforeRequest again with the same requestId: keep the chain.
        if (t.nav?.requestId === d.requestId) return null;
        return {
            ...t,
            page: 0,
            override: null,
            nav: { requestId: d.requestId, url: d.url, chain: [], startedAt: Date.now() },
        };
    });
}, MAIN_FRAME);

chrome.webRequest.onBeforeRedirect.addListener((d) => {
    if (d.tabId < 0) return;
    updateTab(d.tabId, (t) => {
        if (t.nav?.requestId !== d.requestId) return null;
        return { ...t, nav: { ...t.nav, chain: [...t.nav.chain, { url: d.url, statusCode: d.statusCode, location: d.redirectUrl }] } };
    });
}, MAIN_FRAME);

chrome.webRequest.onHeadersReceived.addListener((d) => {
    if (d.tabId < 0) return;
    const headers = {};
    (d.responseHeaders || []).forEach(({ name, value }) => {
        const key = name.toLowerCase();
        if (KEEP_HEADERS.includes(key)) headers[key] = headers[key] ? `${headers[key]}, ${value}` : value;
    });
    updateTab(d.tabId, (t) => {
        if (t.nav?.requestId !== d.requestId) return null;
        return { ...t, nav: { ...t.nav, status: d.statusCode, statusLine: d.statusLine, finalUrl: d.url, headers } };
    });
}, MAIN_FRAME, ['responseHeaders']);

chrome.webRequest.onCompleted.addListener((d) => {
    if (d.tabId < 0) return;
    updateTab(d.tabId, (t) => {
        if (t.nav?.requestId !== d.requestId) return null;
        return { ...t, nav: { ...t.nav, completedAt: Date.now(), fromCache: d.fromCache } };
    }).then(() => refreshBadge(d.tabId));
}, MAIN_FRAME);

chrome.webRequest.onErrorOccurred.addListener((d) => {
    if (d.tabId < 0) return;
    updateTab(d.tabId, (t) => {
        if (t.nav?.requestId !== d.requestId) return null;
        return { ...t, nav: { ...t.nav, error: d.error } };
    });
}, MAIN_FRAME);
