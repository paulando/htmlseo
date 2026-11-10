/*
 * net.js — network checks run from the popup (extension origin + host permissions,
 * so no CORS limits). Never sends cookies (credentials: 'omit') — we want what a
 * crawler sees.
 */

const TRACKING = /^(utm_|gclid$|fbclid$|msclkid$|mc_|_ga$|ref$)/i;
const KEEP_HEADERS = ['x-robots-tag', 'link', 'content-type', 'last-modified', 'cache-control', 'content-language', 'server'];
const ROBOTS_TTL = 10 * 60 * 1000;

/* Same normalisation as analyzer.js (host without www, no hash/tracking params/trailing slash). */
export function normalizeUrl(href, base) {
    try {
        const u = new URL(href, base);
        u.hash = '';
        [...u.searchParams.keys()].forEach((k) => { if (TRACKING.test(k)) u.searchParams.delete(k); });
        const path = u.pathname.replace(/\/+$/, '') || '/';
        return `${u.protocol}//${u.host.toLowerCase().replace(/^www\./, '')}${path}${u.search}`;
    } catch {
        return href;
    }
}

export async function fetchWithTimeout(url, opts = {}, ms = 10000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new DOMException('Timed out', 'TimeoutError')), ms);
    const outer = opts.signal;
    if (outer) {
        if (outer.aborted) ctrl.abort(outer.reason);
        else outer.addEventListener('abort', () => ctrl.abort(outer.reason), { once: true });
    }
    try {
        return await fetch(url, { credentials: 'omit', cache: 'no-store', redirect: 'follow', ...opts, signal: ctrl.signal });
    } finally {
        clearTimeout(timer);
    }
}

export async function readTextCapped(res, maxBytes) {
    if (!res.body) return '';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let text = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        text += decoder.decode(value, { stream: true });
        if (size >= maxBytes) {
            reader.cancel().catch(() => {});
            break;
        }
    }
    return text + decoder.decode();
}

const discard = (res) => { res.body?.cancel().catch(() => {}); };

/* Run worker over items with limited concurrency; stops early when signal aborts. */
export async function pool(items, worker, { concurrency = 6, signal } = {}) {
    let i = 0;
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (i < items.length && !signal?.aborted) {
            const item = items[i++];
            await worker(item);
        }
    });
    await Promise.all(runners);
}

/* ------------------------------------------------------------ HTTP response */

const sameDoc = (a, b) => String(a || '').split('#')[0] === String(b || '').split('#')[0];

/*
 * Prefer what background.js captured during the real navigation (has the full
 * redirect chain). Fall back to re-fetching the URL (SPA routes, extension
 * installed after the page loaded, bfcache…).
 */
export async function getServerInfo(tabId, pageUrl) {
    const key = `tab:${tabId}`;
    let nav = null;
    try { nav = (await chrome.storage.session.get(key))[key]?.nav || null; } catch { /* ignore */ }
    if (nav?.status && !nav.error && sameDoc(nav.finalUrl, pageUrl)) {
        return {
            source: 'navigation',
            httpStatus: nav.status,
            statusLine: nav.statusLine || null,
            requestedUrl: nav.url,
            finalUrl: nav.finalUrl,
            chain: nav.chain || [],
            headers: nav.headers || {},
            fromCache: !!nav.fromCache,
        };
    }
    const res = await fetchWithTimeout(pageUrl, { method: 'GET' });
    discard(res);
    const headers = {};
    KEEP_HEADERS.forEach((k) => { const v = res.headers.get(k); if (v) headers[k] = v; });
    return {
        source: 'refetch',
        httpStatus: res.status,
        requestedUrl: pageUrl,
        finalUrl: res.url,
        chain: res.redirected ? [{ url: pageUrl, statusCode: '3xx', location: res.url }] : [],
        headers,
    };
}

/* --------------------------------------------------------------- robots.txt */

export function parseRobots(text) {
    const groups = [];
    const sitemaps = [];
    let current = null;
    let lastWasAgent = false;
    for (const rawLine of String(text).split(/\r?\n/)) {
        const line = rawLine.replace(/#.*$/, '').trim();
        if (!line) continue;
        const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
        if (!m) continue;
        const field = m[1].toLowerCase();
        const value = m[2].trim();
        if (field === 'user-agent') {
            if (!current || !lastWasAgent) {
                current = { agents: [], rules: [] };
                groups.push(current);
            }
            current.agents.push(value.toLowerCase());
            lastWasAgent = true;
        } else if (field === 'allow' || field === 'disallow') {
            lastWasAgent = false;
            if (current && value) current.rules.push({ type: field, pattern: value });
        } else if (field === 'sitemap') {
            if (value) sitemaps.push(value);
        } else {
            lastWasAgent = false;
        }
    }
    return { groups, sitemaps };
}

function patternToRegex(pattern) {
    const anchored = pattern.endsWith('$');
    const body = anchored ? pattern.slice(0, -1) : pattern;
    const src = [...body].map((ch) => (ch === '*' ? '.*' : ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))).join('');
    return new RegExp(`^${src}${anchored ? '$' : ''}`);
}

/* Google semantics: most specific group (exact UA token, else "*"); longest matching rule wins; ties → allow. */
export function robotsVerdict(parsed, pathAndQuery, ua = 'googlebot') {
    const specific = parsed.groups.filter((g) => g.agents.includes(ua));
    const chosen = specific.length ? specific : parsed.groups.filter((g) => g.agents.includes('*'));
    const rules = chosen.flatMap((g) => g.rules);
    let best = null;
    for (const rule of rules) {
        let re;
        try { re = patternToRegex(rule.pattern); } catch { continue; }
        if (!re.test(pathAndQuery)) continue;
        if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.type === 'allow')) best = rule;
    }
    return { allowed: !best || best.type === 'allow', rule: best, agent: specific.length ? ua : chosen.length ? '*' : null };
}

export async function getRobots(pageUrl) {
    const u = new URL(pageUrl);
    const key = `robots:${u.origin}`;
    let cached = null;
    try { cached = (await chrome.storage.session.get(key))[key]; } catch { /* ignore */ }
    if (!cached || Date.now() - cached.fetchedAt > ROBOTS_TTL) {
        try {
            const res = await fetchWithTimeout(`${u.origin}/robots.txt`);
            let text = '';
            if (res.ok) text = await readTextCapped(res, 512 * 1024); else discard(res);
            cached = { fetchedAt: Date.now(), httpStatus: res.status, text };
        } catch (e) {
            cached = { fetchedAt: Date.now(), httpStatus: null, error: e.message, text: '' };
        }
        try { await chrome.storage.session.set({ [key]: cached }); } catch { /* ignore */ }
    }
    const parsed = parseRobots(cached.text);
    let verdict = null;
    if (cached.httpStatus >= 200 && cached.httpStatus < 300) {
        verdict = robotsVerdict(parsed, u.pathname + u.search);
    } else if (cached.httpStatus >= 400 && cached.httpStatus < 500) {
        verdict = { allowed: true, rule: null, agent: null, note: 'No robots.txt — everything is allowed.' };
    }
    return {
        url: `${u.origin}/robots.txt`,
        httpStatus: cached.httpStatus,
        error: cached.error || null,
        sitemaps: parsed.sitemaps,
        groupCount: parsed.groups.length,
        verdict,
    };
}

/* ------------------------------------------------------------------ sitemap */

const decodeXml = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

export async function getSitemap(sitemapUrl, pageUrl) {
    if (/\.gz(\?|$)/i.test(sitemapUrl)) return { url: sitemapUrl, httpStatus: null, note: 'Gzipped sitemap — not inspected.' };
    const res = await fetchWithTimeout(sitemapUrl, {}, 15000);
    if (!res.ok) {
        discard(res);
        return { url: sitemapUrl, httpStatus: res.status };
    }
    const MAX = 5 * 1024 * 1024;
    const text = await readTextCapped(res, MAX);
    const isIndex = /<sitemapindex[\s>]/i.test(text);
    const locs = [...text.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => decodeXml(m[1]));
    const target = normalizeUrl(pageUrl);
    return {
        url: sitemapUrl,
        finalUrl: res.url,
        httpStatus: res.status,
        isIndex,
        urlCount: locs.length,
        children: isIndex ? locs.slice(0, 20) : [],
        found: isIndex ? null : locs.some((l) => normalizeUrl(l) === target),
        truncated: text.length >= MAX,
    };
}

/* ------------------------------------------------------------- link checker */

export async function checkLink(url, signal) {
    const started = performance.now();
    try {
        let res = await fetchWithTimeout(url, { method: 'HEAD', signal });
        if ([403, 405, 501].includes(res.status)) {
            res = await fetchWithTimeout(url, { method: 'GET', signal });
            discard(res);
        }
        return { status: res.status, ok: res.ok, redirected: res.redirected, finalUrl: res.url, ms: Math.round(performance.now() - started) };
    } catch (e) {
        let error = e?.message || 'network error';
        if (e?.name === 'TimeoutError') error = 'timeout';
        else if (signal?.aborted) error = 'stopped';
        else if (e?.name === 'TypeError') error = 'unreachable'; // DNS, TLS, connection refused (or CORS in the dev harness)
        return { status: 0, ok: false, error };
    }
}

/* ------------------------------------------------------- hreflang return links */

export async function checkHreflangReturn(alt, pageUrl, signal) {
    try {
        const res = await fetchWithTimeout(alt.href, { signal }, 12000);
        if (!res.ok) {
            discard(res);
            return { status: res.status, ok: false, reason: `HTTP ${res.status}` };
        }
        const html = await readTextCapped(res, 3 * 1024 * 1024);
        const doc = new DOMParser().parseFromString(html, 'text/html'); // inert: no scripts, no loads
        const target = normalizeUrl(pageUrl);
        const alternates = [...doc.querySelectorAll('link[rel="alternate" i][hreflang]')]
            .map((l) => ({ lang: l.getAttribute('hreflang'), href: normalizeUrl(l.getAttribute('href') || '', res.url) }));
        const back = alternates.find((l) => l.href === target);
        return {
            status: res.status,
            ok: !!back,
            returnLang: back?.lang || null,
            reason: back ? null : alternates.length ? 'No link back to this page' : 'No hreflang tags on that page',
        };
    } catch (e) {
        return { status: 0, ok: false, reason: e?.name === 'TimeoutError' ? 'Timeout' : (e?.message || 'Network error') };
    }
}
