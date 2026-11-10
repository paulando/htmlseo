import { h, card, cardHead, chip, muted, empty, link, limited, safeUrl, filterPills, togglePill, truncate, meter } from '../dom.js';
import { state, rerender } from '../state.js';
import { scrollInPage } from '../page.js';
import { checkLink, pool, normalizeUrl } from '../net.js';
import { toggleOverlay } from './overlay-toggle.js';

const KIND_LABEL = { internal: 'Internal', external: 'External', mailto: 'Email', tel: 'Phone', anchor: 'Anchor', js: 'JS', empty: 'No href', other: 'Other' };
const checkKey = (href) => String(href).split('#')[0];
export const linkCacheKey = (pageUrl) => `links:${normalizeUrl(pageUrl)}`;

function checkableUrls(d) {
    return [...new Set(d.links.filter((l) => (l.kind === 'internal' || l.kind === 'external') && safeUrl(l.href)).map((l) => checkKey(l.href)))];
}

export async function startLinkCheck(d) {
    const urls = checkableUrls(d).slice(0, state.settings.linkCheckLimit);
    const controller = new AbortController();
    state.linkCheck = { running: true, done: 0, total: urls.length, results: {}, controller };
    rerender();
    await pool(urls, async (url) => {
        state.linkCheck.results[url] = await checkLink(url, controller.signal);
        state.linkCheck.done++;
        rerender(true);
    }, { concurrency: state.settings.linkCheckConcurrency, signal: controller.signal });
    state.linkCheck.running = false;
    try {
        await chrome.storage.session.set({ [linkCacheKey(d.url)]: { at: Date.now(), done: state.linkCheck.done, total: state.linkCheck.total, results: state.linkCheck.results } });
    } catch { /* ignore */ }
    rerender();
}

function statusChip(r) {
    if (!r) return null;
    if (r.error) return chip(r.error, r.error === 'stopped' ? '' : 'err');
    if (r.status >= 400) return chip(String(r.status), 'err');
    if (r.redirected) return chip(`${r.status} via redirect`, 'warn');
    return chip(String(r.status), 'ok');
}

function checkControls(d) {
    const lc = state.linkCheck;
    const total = checkableUrls(d).length;
    if (lc?.running) {
        return h('div', { class: 'progress-row' },
            h('div', { class: 'progress-text', text: `Checking ${lc.done} / ${lc.total}…` }),
            meter(lc.done, lc.total || 1),
            h('button', { class: 'btn-sm', text: 'Stop', onclick: () => lc.controller.abort() }));
    }
    const broken = lc ? Object.values(lc.results).filter((r) => !r.ok && r.error !== 'stopped').length : 0;
    const limit = state.settings.linkCheckLimit;
    return h('div', { class: 'progress-row' },
        h('div', { class: 'progress-text' },
            lc ? [`Checked ${lc.done} of ${lc.total} URLs · `, broken ? chip(`${broken} broken`, 'err') : chip('none broken', 'ok')]
                : muted(`${total} unique http(s) URLs${total > limit ? ` (first ${limit} will be checked)` : ''}. Requests are sent from your browser without cookies.`)),
        h('button', { class: 'btn-sm', text: lc ? 'Re-check' : 'Check links', disabled: total ? null : true, onclick: () => startLinkCheck(d) }));
}

export function renderLinks(d) {
    const results = state.linkCheck?.results || {};
    const isBroken = (l) => { const r = results[checkKey(l.href)]; return r && !r.ok && r.error !== 'stopped'; };
    const groups = {
        all: d.links,
        internal: d.links.filter((l) => l.kind === 'internal'),
        external: d.links.filter((l) => l.kind === 'external'),
        nofollow: d.links.filter((l) => l.nofollow),
        other: d.links.filter((l) => !['internal', 'external'].includes(l.kind)),
        broken: d.links.filter(isBroken),
    };
    const list = groups[state.filters.links] || d.links;
    const setFilter = (v) => { state.filters.links = v; rerender(); };
    const filters = [
        ['all', 'All', groups.all.length],
        ['internal', 'Internal', groups.internal.length],
        ['external', 'External', groups.external.length],
        ['nofollow', 'Nofollow', groups.nofollow.length],
        ['other', 'Other', groups.other.length],
    ];
    if (state.linkCheck) filters.push(['broken', 'Broken', groups.broken.length]);

    return [
        card(cardHead('Link check'), checkControls(d)),
        card(
            cardHead('Links',
                togglePill('Nofollow on page', state.overlay.includes('nofollow'), (on) => toggleOverlay('nofollow', on)),
                togglePill('Int/ext on page', state.overlay.includes('links'), (on) => toggleOverlay('links', on))),
            h('div', { style: 'margin-bottom:10px' }, filterPills(state.filters.links, filters, setFilter)),
            list.length
                ? h('div', { class: 'list' }, limited(list, (l) => h('div', { class: 'item clickable', title: 'Scroll to link', onclick: () => scrollInPage('a', l.index) },
                    chip(KIND_LABEL[l.kind], l.kind === 'external' ? 'accent' : ['empty', 'js'].includes(l.kind) ? 'warn' : ''),
                    h('div', { class: 'item-body' },
                        h('div', { class: 'item-title' }, l.text ? truncate(l.text, 120) : muted('(no anchor text)')),
                        h('div', { class: 'item-sub' }, safeUrl(l.href) ? link(l.href, truncate(l.href, 110)) : (l.rawHref ?? '(no href attribute)'))),
                    h('div', { class: 'item-chips' },
                        statusChip(results[checkKey(l.href)]),
                        l.target ? chip(`target=${l.target}`) : null,
                        l.rel ? chip(`rel=${l.rel}`, l.nofollow ? 'warn' : '') : (l.kind === 'external' ? chip('no rel', 'info') : null)))))
                : empty('No links', state.filters.links === 'all' ? 'This page has no <a> elements.' : 'Nothing matches this filter.'),
        ),
    ];
}
