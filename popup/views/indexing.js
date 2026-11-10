import { h, card, cardHead, chip, kv, link, muted, plural, truncate } from '../dom.js';
import { state } from '../state.js';

const NOINDEX = /\b(noindex|none)\b/i;

/* Combines page meta + server response + robots.txt into one verdict. */
export function indexVerdict(d) {
    const blockers = [];
    const soft = [];
    const m = d.meta;
    if (NOINDEX.test(`${m.robots || ''},${m.googlebot || ''}`)) blockers.push('meta robots noindex');
    const s = state.server;
    if (s?.status === 'done' && !s.error) {
        if (s.httpStatus >= 400) blockers.push(`HTTP ${s.httpStatus}`);
        if (NOINDEX.test(s.headers?.['x-robots-tag'] || '')) blockers.push('X-Robots-Tag noindex');
    }
    if (state.robots?.status === 'done' && state.robots.verdict && !state.robots.verdict.allowed) blockers.push('blocked by robots.txt');
    if (m.canonical && !m.canonicalMatches) soft.push('canonical points to another URL');
    const pending = s?.status === 'loading' || state.robots?.status === 'loading';

    if (blockers.length) return { short: 'No', cls: 'err', note: truncate(blockers.join(', '), 44), blockers, soft, pending };
    if (soft.length) return { short: 'Partly', cls: 'warn', note: soft.join(', '), blockers, soft, pending };
    return { short: pending ? '…' : 'Yes', cls: pending ? '' : 'ok', note: pending ? 'checking server…' : 'no blockers found', blockers, soft, pending };
}

function statusChip(code) {
    if (!code) return chip('—');
    if (code === '3xx') return chip('redirect', 'warn');
    if (code >= 500) return chip(String(code), 'err');
    if (code >= 400) return chip(String(code), 'err');
    if (code >= 300) return chip(String(code), 'warn');
    return chip(String(code), 'ok');
}

function loading(text) {
    return h('div', { class: 'card-sub', text });
}

function responseCard() {
    const s = state.server;
    if (!s || s.status === 'loading') return card(cardHead('HTTP response'), loading('Checking…'));
    if (s.error) return card(cardHead('HTTP response', chip('unavailable', 'warn')), muted(s.error));
    const steps = [
        ...s.chain.map((c) => h('div', { class: 'step' }, statusChip(c.statusCode), link(c.url, truncate(c.url, 90)))),
        h('div', { class: 'step' }, statusChip(s.httpStatus), link(s.finalUrl, truncate(s.finalUrl, 90))),
    ];
    const headers = Object.entries(s.headers || {});
    return card(
        cardHead('HTTP response',
            chip(s.source === 'navigation' ? 'from page load' : 're-fetched', s.source === 'navigation' ? 'info' : ''),
            s.chain.length ? chip(plural(s.chain.length, 'redirect'), 'warn') : null),
        h('div', { class: 'steps' }, steps),
        s.source === 'refetch' ? muted('Re-fetched without cookies; intermediate redirect codes are not visible this way. Reload the tab to capture the real navigation.') : null,
        headers.length ? h('div', { style: 'margin-top:10px' }, headers.map(([k, v]) => kv(k, k === 'x-robots-tag' && NOINDEX.test(v) ? [v, chip('noindex', 'err')] : truncate(v, 300)))) : null,
    );
}

function robotsCard() {
    const r = state.robots;
    if (!r || r.status === 'loading') return card(cardHead('robots.txt'), loading('Checking…'));
    if (r.error) return card(cardHead('robots.txt', chip('error', 'warn')), muted(r.error));
    const v = r.verdict;
    let verdictChip = chip(`HTTP ${r.httpStatus}`, r.httpStatus >= 500 ? 'err' : '');
    if (v) verdictChip = v.allowed ? chip('allowed', 'ok') : chip('blocked', 'err');
    return card(
        cardHead('robots.txt', verdictChip, link(r.url, 'open')),
        kv('Status', `HTTP ${r.httpStatus ?? '—'}`),
        kv('Group used', v?.agent ? `User-agent: ${v.agent}` : muted(v?.note || 'none matched — everything allowed')),
        kv('Matching rule', v?.rule ? h('code', { text: `${v.rule.type === 'allow' ? 'Allow' : 'Disallow'}: ${v.rule.pattern}` }) : muted('no rule matches this URL')),
        kv('Sitemaps', r.sitemaps.length ? r.sitemaps.map((s) => h('div', {}, link(s))) : muted('none listed')),
    );
}

function sitemapCard() {
    const sm = state.sitemap;
    if (!sm) return null;
    if (sm.status === 'loading') return card(cardHead('Sitemap'), loading('Checking…'));
    if (sm.error) return card(cardHead('Sitemap', chip('error', 'warn')), muted(sm.error));
    let found = null;
    if (sm.found === true) found = chip('page listed', 'ok');
    else if (sm.found === false) found = chip('page not listed', 'info');
    else if (sm.isIndex) found = chip('sitemap index', 'info');
    return card(
        cardHead('Sitemap', found, sm.httpStatus ? statusChip(sm.httpStatus) : null),
        kv('URL', link(sm.url), sm.guessed ? chip('guessed', 'info') : null),
        sm.note ? kv('Note', sm.note) : null,
        sm.urlCount != null ? kv(sm.isIndex ? 'Sitemaps' : 'URLs', `${sm.urlCount}${sm.truncated ? '+ (first 5 MB)' : ''}`) : null,
        sm.children?.length ? kv('Children', sm.children.slice(0, 10).map((c) => h('div', {}, link(c, truncate(c, 80))))) : null,
    );
}

export function renderIndexing(d) {
    const v = indexVerdict(d);
    const m = d.meta;
    const s = state.server?.status === 'done' && !state.server.error ? state.server : null;
    const xrt = s?.headers?.['x-robots-tag'];
    return [
        card(
            h('div', { class: 'verdict' },
                h('div', { class: `verdict-badge ${v.cls}`, text: v.short }),
                h('div', {},
                    h('div', { class: 'verdict-title', text: v.blockers.length ? 'Not indexable' : v.pending ? 'Checking indexability…' : v.soft.length ? 'Indexable, with caveats' : 'Indexable' }),
                    h('div', { class: 'card-sub', text: [...v.blockers, ...v.soft].join(' · ') || 'Meta robots, X-Robots-Tag, HTTP status and robots.txt all allow indexing.' }))),
        ),
        card(
            cardHead('Signals'),
            kv('Meta robots', m.robots || muted('not set'), NOINDEX.test(m.robots || '') ? chip('noindex', 'err') : null),
            m.googlebot ? kv('Googlebot meta', m.googlebot, NOINDEX.test(m.googlebot) ? chip('noindex', 'err') : null) : null,
            kv('X-Robots-Tag', s ? (xrt || muted('not set')) : muted('…'), xrt && NOINDEX.test(xrt) ? chip('noindex', 'err') : null),
            kv('HTTP status', s ? statusChip(s.httpStatus) : muted('…')),
            kv('robots.txt', state.robots?.verdict ? (state.robots.verdict.allowed ? chip('allowed', 'ok') : chip('blocked', 'err')) : muted('…')),
            kv('Canonical', m.canonical ? link(m.canonical, truncate(m.canonical, 80)) : muted('none'), m.canonical ? chip(m.canonicalMatches ? 'self' : 'elsewhere', m.canonicalMatches ? 'ok' : 'warn') : null),
            v.blockers.includes('blocked by robots.txt') && NOINDEX.test(`${m.robots},${xrt}`)
                ? muted('Note: Google cannot see a noindex on a page that robots.txt blocks from crawling.')
                : null,
        ),
        responseCard(),
        robotsCard(),
        sitemapCard(),
    ];
}
