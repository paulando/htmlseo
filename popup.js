/*
 * popup.js — runs the analyzer in the active tab and renders the result.
 *
 * SAFETY RULE: everything coming from the page is untrusted. Build DOM with h()
 * (which only ever sets textContent / attributes) and pass URLs through safeUrl().
 * Never use innerHTML with page data.
 */

const TABS = ['overview', 'meta', 'headings', 'images', 'links', 'schema'];
const LIST_LIMIT = 500;
const STORAGE_KEY = 'htmlseo.tab';

const state = {
    tabId: null,
    data: null,
    tab: loadTab(),
    filters: { images: 'all', links: 'all' },
};

const $ = (sel, root = document) => root.querySelector(sel);

/* ================================================================ helpers */

function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style') el.style.cssText = v; // only ever our own values
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
        if (c == null || c === false) continue;
        el.append(c instanceof Node ? c : String(c));
    }
    return el;
}

function safeUrl(url) {
    try {
        const u = new URL(url);
        return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
    } catch {
        return null;
    }
}

function link(url, text = url) {
    const href = safeUrl(url);
    if (!href) return h('span', { text });
    return h('a', { href, target: '_blank', rel: 'noopener noreferrer', text, onclick: (e) => e.stopPropagation() });
}

const chip = (text, cls = '') => h('span', { class: `chip ${cls}`.trim(), text });
const card = (...children) => h('div', { class: 'card' }, ...children);
const cardHead = (title, ...extra) => h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: title }), ...extra);
const kv = (key, ...val) => h('div', { class: 'kv' }, h('div', { class: 'kv-key', text: key }), h('div', { class: 'kv-val' }, ...val));
const muted = (text) => h('span', { class: 'card-sub', text });
const empty = (title, text) => h('div', { class: 'empty' }, h('div', { class: 'empty-title', text: title }), text ? h('div', { text }) : null);
const truncate = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const isImageUrl = (s) => /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(s);

function loadTab() {
    try {
        const t = localStorage.getItem(STORAGE_KEY);
        return TABS.includes(t) ? t : 'overview';
    } catch {
        return 'overview';
    }
}

function issuesFor(section, level) {
    return state.data.issues.filter((i) => (!section || i.section === section) && (!level || i.level === level));
}

/* image hover preview */
function attachPreview(el, src) {
    const url = safeUrl(src);
    if (!url) return el;
    const preview = $('#preview');
    const place = (ev) => {
        let x = ev.clientX + 16;
        if (x + 230 > window.innerWidth) x = ev.clientX - 236;
        const y = Math.max(8, Math.min(ev.clientY + 12, window.innerHeight - 230));
        preview.style.left = `${Math.max(8, x)}px`;
        preview.style.top = `${y}px`;
    };
    el.addEventListener('mouseenter', (ev) => { preview.src = url; preview.hidden = false; place(ev); });
    el.addEventListener('mousemove', place);
    el.addEventListener('mouseleave', () => { preview.hidden = true; preview.removeAttribute('src'); });
    return el;
}

/* Injected into the page: scroll to the nth element matching selector and flash an outline. */
function pageScrollTo(selector, index) {
    const el = document.querySelectorAll(selector)[index];
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const { outline, outlineOffset } = el.style;
    el.style.outline = '3px solid #ef4444';
    el.style.outlineOffset = '3px';
    setTimeout(() => { el.style.outline = outline; el.style.outlineOffset = outlineOffset; }, 2000);
    return true;
}

function scrollInPage(selector, index) {
    chrome.scripting.executeScript({ target: { tabId: state.tabId }, func: pageScrollTo, args: [selector, index] })
        .catch(() => {});
}

function filterPills(tab, options) {
    return h('div', { class: 'pills' }, options.map(([value, label, count]) => h('button', {
        class: 'pill',
        'aria-pressed': String(state.filters[tab] === value),
        onclick: () => { state.filters[tab] = value; render(); },
    }, label, h('span', { class: 'count', text: count }))));
}

function limited(items, renderItem) {
    const shown = items.slice(0, LIST_LIMIT).map(renderItem);
    if (items.length > LIST_LIMIT) shown.push(h('div', { class: 'item' }, muted(`Showing first ${LIST_LIMIT} of ${items.length}.`)));
    return shown;
}

/* ================================================================ analysis */

async function analyze() {
    const refresh = $('#refresh');
    refresh.classList.add('spinning');
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        state.tabId = tab?.id;
        await chrome.scripting.executeScript({ target: { tabId: state.tabId }, files: ['analyzer.js'] });
        const [res] = await chrome.scripting.executeScript({ target: { tabId: state.tabId }, func: () => analyzePage() });
        if (!res?.result) throw new Error('No result from page');
        state.data = res.result;
    } catch (e) {
        state.data = null;
        renderUnavailable(e);
        return;
    } finally {
        refresh.classList.remove('spinning');
    }
    const errors = issuesFor(null, 'error').length;
    chrome.action.setBadgeText({ tabId: state.tabId, text: errors ? String(errors) : '' }).catch(() => {});
    render();
}

/* ================================================================ render */

function render() {
    if (!state.data) return;
    const d = state.data;
    $('#page-title').textContent = d.meta.title || '(no title)';
    $('#page-url').textContent = d.url;

    document.querySelectorAll('.rail-btn').forEach((btn) => {
        const tab = btn.dataset.tab;
        btn.setAttribute('aria-current', tab === state.tab ? 'page' : 'false');
        const pill = $('.rail-pill', btn);
        const section = tab === 'overview' ? null : tab;
        const errs = issuesFor(section, 'error').length;
        const warns = tab === 'overview' ? 0 : issuesFor(section, 'warning').length;
        pill.hidden = !errs && !warns;
        pill.textContent = errs || warns;
        pill.classList.toggle('warn', !errs);
    });

    const view = $('#view');
    const scrollTop = view.dataset.tab === state.tab ? view.scrollTop : 0;
    view.replaceChildren(...[].concat(RENDERERS[state.tab](d)));
    view.dataset.tab = state.tab;
    view.scrollTop = scrollTop;
}

function renderUnavailable(err) {
    $('#page-title').textContent = 'Page can’t be analyzed';
    $('#page-url').textContent = '';
    document.querySelectorAll('.rail-pill').forEach((p) => { p.hidden = true; });
    $('#view').replaceChildren(card(empty(
        'This page can’t be analyzed',
        'Chrome doesn’t allow extensions on chrome:// pages, the Web Store, or some built-in viewers. On a normal page, try reloading the tab.',
    ), h('div', { class: 'card-sub', style: 'text-align:center', text: err?.message || '' })));
}

/* ---------------------------------------------------------------- overview */

function tile(label, value, cls, note, tab) {
    return h('button', { class: `tile ${cls || ''}`, onclick: tab ? () => go(tab) : null },
        h('span', { class: 'tile-label', text: label }),
        h('span', { class: 'tile-value', text: value }),
        note ? h('span', { class: 'tile-note', text: note }) : null);
}

function renderOverview(d) {
    const errs = issuesFor(null, 'error').length;
    const warns = issuesFor(null, 'warning').length;
    const h1 = d.headings.filter((x) => x.level === 1).length;
    const noAlt = d.images.filter((i) => !i.hasAlt).length;
    const internal = d.links.filter((l) => l.kind === 'internal').length;
    const external = d.links.filter((l) => l.kind === 'external').length;
    const types = schemaTypes(d);

    const order = { error: 0, warning: 1, info: 2 };
    const issues = [...d.issues].sort((a, b) => order[a.level] - order[b.level]);

    const enc = encodeURIComponent(d.url);
    const quick = [
        ['Rich Results', `https://search.google.com/test/rich-results?url=${enc}`],
        ['Schema.org', `https://validator.schema.org/#url=${enc}`],
        ['W3C validator', `https://validator.w3.org/nu/?doc=${enc}`],
        ['PageSpeed', `https://pagespeed.web.dev/analysis?url=${enc}`],
        ['GTmetrix', `https://gtmetrix.com/?url=${enc}`],
        ['WebPageTest', `https://www.webpagetest.org/?url=${enc}`],
        ['site: search', `https://www.google.com/search?q=${encodeURIComponent(`site:${d.url}`)}`],
    ];

    return [
        h('div', { class: 'grid grid-3' },
            tile('Errors', errs, errs ? 'err' : 'ok', errs ? 'Fix these first' : 'No errors'),
            tile('Warnings', warns, warns ? 'warn' : 'ok', `${plural(issuesFor(null, 'info').length, 'note')}`),
            tile('H1 headings', h1, h1 === 1 ? 'ok' : h1 ? 'warn' : 'err', `${plural(d.headings.length, 'heading')} total`, 'headings'),
            tile('Images without alt', noAlt, noAlt ? 'warn' : 'ok', `${plural(d.images.length, 'image')} total`, 'images'),
            tile('Links', `${internal} / ${external}`, '', 'internal / external', 'links'),
            tile('Schema entities', d.schema.entityCount, d.schema.entityCount ? 'ok' : '', types.length ? truncate(types.map(([t]) => t).join(', '), 40) : 'None found', 'schema')),
        card(
            cardHead('Issues', muted(plural(issues.length, 'item'))),
            issues.length
                ? h('div', { class: 'list' }, issues.map((i) => h('div', { class: 'item clickable', onclick: () => go(i.section) },
                    chip(i.level, i.level),
                    h('div', { class: 'item-body item-title', text: i.message }),
                    chip(i.section))))
                : empty('All checks passed', 'Nothing to fix on this page.'),
        ),
        card(
            cardHead('Quick links'),
            h('div', { class: 'pills' }, quick.map(([label, url]) => h('a', { class: 'pill', href: url, target: '_blank', rel: 'noopener noreferrer', text: label }))),
        ),
    ];
}

/* ---------------------------------------------------------------- meta */

function lengthInfo(len, min, max) {
    const cls = !len ? 'err' : len < min || len > max ? 'warn' : 'ok';
    const pct = Math.min(100, Math.round((len / (max * 1.25)) * 100));
    return [
        chip(`${len} chars`, cls),
        h('div', { class: `meter ${cls}` }, h('i', { style: `width:${pct}%` })),
    ];
}

function renderMeta(d) {
    const m = d.meta;
    let host = '';
    let path = '';
    try {
        const u = new URL(d.url);
        host = u.host;
        path = u.pathname.split('/').filter(Boolean).join(' › ');
    } catch { /* ignore */ }

    const robotsChip = /\bnoindex\b|\bnone\b/i.test(`${m.robots},${m.googlebot}`)
        ? chip('noindex', 'err')
        : /\bnofollow\b/i.test(`${m.robots},${m.googlebot}`) ? chip('nofollow', 'warn') : chip('indexable', 'ok');

    const canonicalChip = !m.canonical ? chip('missing', 'warn')
        : m.canonicalCount > 1 ? chip(`${m.canonicalCount} tags`, 'err')
            : m.canonicalMatches ? chip('self', 'ok') : chip('points elsewhere', 'warn');

    const tagRows = (tags) => tags.map((t) => kv(t.prop.replace(/[_:]/g, ' '), isImageUrl(t.content) || /image/.test(t.prop)
        ? attachPreview(link(t.content), t.content)
        : safeUrl(t.content) ? link(t.content) : t.content || muted('(empty)')));

    return [
        card(
            cardHead('Search preview', muted('approximate')),
            h('div', { class: 'serp' },
                h('div', { class: 'serp-url', text: [host, path].filter(Boolean).join(' › ') }),
                h('div', { class: 'serp-title', text: m.title || '(no title)' }),
                h('div', { class: 'serp-desc', text: m.description || 'No meta description — Google will pick text from the page.' })),
        ),
        card(
            cardHead('Meta tags'),
            kv('Title', m.title || chip('missing', 'err'), m.title ? h('div', {}, lengthInfo(m.titleLength, 30, 60)) : null),
            kv('Description', m.description || chip('missing', 'err'), m.description ? h('div', {}, lengthInfo(m.descriptionLength, 70, 160)) : null),
            kv('Canonical', m.canonical ? link(m.canonical) : null, canonicalChip),
            kv('Robots', m.robots || muted('not set (defaults to index, follow)'), robotsChip),
            m.googlebot ? kv('Googlebot', m.googlebot) : null,
            kv('Lang', m.lang || chip('missing', 'warn')),
            kv('Viewport', m.viewport || chip('missing', 'warn')),
            kv('Charset', m.charset || chip('missing', 'info')),
        ),
        m.hreflang.length ? card(
            cardHead('Hreflang', muted(plural(m.hreflang.length, 'alternate'))),
            m.hreflang.map((x) => kv(x.lang, link(x.href))),
        ) : null,
        card(
            cardHead('Open Graph', m.ogImage ? null : chip('no og:image', 'err')),
            m.ogImage && safeUrl(m.ogImage) ? h('img', { class: 'og-image', src: safeUrl(m.ogImage), alt: 'og:image' }) : null,
            m.og.length ? tagRows(m.og) : muted('No Open Graph tags.'),
        ),
        card(
            cardHead('Twitter'),
            m.twitter.length ? tagRows(m.twitter) : muted('No Twitter card tags (Open Graph is used as a fallback).'),
        ),
    ];
}

/* ---------------------------------------------------------------- headings */

function renderHeadings(d) {
    const counts = [1, 2, 3, 4, 5, 6].map((l) => [l, d.headings.filter((x) => x.level === l).length]).filter(([, n]) => n);
    const issues = issuesFor('headings');
    return [
        issues.length ? card(cardHead('Checks'), h('div', { class: 'list' }, issues.map((i) => h('div', { class: 'item' }, chip(i.level, i.level), h('div', { class: 'item-body', text: i.message }))))) : null,
        card(
            cardHead('Outline', h('div', { class: 'pills' }, counts.map(([l, n]) => chip(`H${l} · ${n}`, l === 1 ? 'accent' : '')))),
            d.headings.length
                ? h('div', { class: 'list' }, limited(d.headings, (x) => h('div', {
                    class: 'item clickable h-row',
                    'data-level': x.level,
                    style: `--indent:${x.level - 1}`,
                    title: 'Scroll to heading',
                    onclick: () => scrollInPage('h1, h2, h3, h4, h5, h6', x.index),
                },
                chip(x.tag, 'tag'),
                h('div', { class: 'item-body item-title' }, x.text || muted('(empty)')),
                h('div', { class: 'item-chips' },
                    x.skip ? chip('skipped level', 'warn') : null,
                    x.hidden ? chip('hidden', 'warn') : null,
                    !x.text ? chip('empty', 'err') : null))))
                : empty('No headings', 'This page has no h1–h6 elements.'),
        ),
    ];
}

/* ---------------------------------------------------------------- images */

function renderImages(d) {
    const groups = {
        all: d.images,
        missing: d.images.filter((i) => !i.hasAlt),
        decorative: d.images.filter((i) => i.decorative),
        lazy: d.images.filter((i) => i.lazy),
    };
    const list = groups[state.filters.images] || d.images;
    return card(
        cardHead('Images', filterPills('images', [
            ['all', 'All', groups.all.length],
            ['missing', 'Missing alt', groups.missing.length],
            ['decorative', 'Decorative', groups.decorative.length],
            ['lazy', 'Lazy', groups.lazy.length],
        ])),
        list.length
            ? h('div', { class: 'list' }, limited(list, (img) => {
                const src = safeUrl(img.src);
                const file = img.src ? decodeURIComponent(img.src.split(/[?#]/)[0].split('/').pop() || img.src) : '(no src)';
                return h('div', { class: 'item clickable', title: 'Scroll to image', onclick: () => scrollInPage('img', img.index) },
                    attachPreview(h('img', { class: 'thumb', src, alt: '', loading: 'lazy' }), img.src),
                    h('div', { class: 'item-body' },
                        h('div', { class: 'item-title' }, img.hasAlt ? (img.alt || muted('alt="" (decorative)')) : chip('no alt attribute', 'warn')),
                        h('div', { class: 'item-sub' }, src ? link(img.src, truncate(file, 80)) : truncate(file, 80))),
                    h('div', { class: 'item-chips' },
                        img.width ? chip(`${img.width}×${img.height}`) : null,
                        img.lazy ? chip('lazy', 'info') : null,
                        img.hidden ? chip('hidden') : null));
            }))
            : empty('No images', state.filters.images === 'all' ? 'This page has no <img> elements.' : 'Nothing matches this filter.'),
    );
}

/* ---------------------------------------------------------------- links */

const KIND_LABEL = { internal: 'Internal', external: 'External', mailto: 'Email', tel: 'Phone', anchor: 'Anchor', js: 'JS', empty: 'No href', other: 'Other' };

function renderLinks(d) {
    const groups = {
        all: d.links,
        internal: d.links.filter((l) => l.kind === 'internal'),
        external: d.links.filter((l) => l.kind === 'external'),
        nofollow: d.links.filter((l) => l.nofollow),
        other: d.links.filter((l) => !['internal', 'external'].includes(l.kind)),
    };
    const list = groups[state.filters.links] || d.links;
    return card(
        cardHead('Links', filterPills('links', [
            ['all', 'All', groups.all.length],
            ['internal', 'Internal', groups.internal.length],
            ['external', 'External', groups.external.length],
            ['nofollow', 'Nofollow', groups.nofollow.length],
            ['other', 'Other', groups.other.length],
        ])),
        list.length
            ? h('div', { class: 'list' }, limited(list, (l) => h('div', { class: 'item clickable', title: 'Scroll to link', onclick: () => scrollInPage('a', l.index) },
                chip(KIND_LABEL[l.kind], l.kind === 'external' ? 'accent' : ['empty', 'js'].includes(l.kind) ? 'warn' : ''),
                h('div', { class: 'item-body' },
                    h('div', { class: 'item-title' }, l.text ? truncate(l.text, 120) : muted('(no anchor text)')),
                    h('div', { class: 'item-sub' }, safeUrl(l.href) ? link(l.href, truncate(l.href, 110)) : (l.rawHref ?? '(no href attribute)'))),
                h('div', { class: 'item-chips' },
                    l.target ? chip(`target=${l.target}`) : null,
                    l.rel ? chip(`rel=${l.rel}`, l.nofollow ? 'warn' : '') : (l.kind === 'external' ? chip('no rel', 'info') : null)))))
            : empty('No links', state.filters.links === 'all' ? 'This page has no <a> elements.' : 'Nothing matches this filter.'),
    );
}

/* ---------------------------------------------------------------- schema */

function schemaEntities(d) {
    return [
        ...d.schema.jsonld.flatMap((b) => b.entities.map((e) => ({ ...e, source: `JSON-LD #${b.index + 1}` }))),
        ...d.schema.microdata.map((e) => ({ ...e, source: 'Microdata' })),
    ];
}

function schemaTypes(d) {
    const counts = new Map();
    schemaEntities(d).forEach((e) => (e.type || '(no @type)').split(', ').forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
    return [...counts.entries()];
}

function typeLabel(t) {
    return [].concat(t).map((x) => String(x).replace(/^https?:\/\/schema\.org\//i, '')).join(', ');
}

function leafValue(value) {
    if (value === null) return h('span', { class: 'v bool', text: 'null' });
    if (typeof value === 'number') return h('span', { class: 'v num', text: String(value) });
    if (typeof value === 'boolean') return h('span', { class: 'v bool', text: String(value) });
    const s = String(value);
    if (safeUrl(s)) {
        const a = link(s, truncate(s, 120));
        a.classList.add('v');
        return isImageUrl(s) ? attachPreview(a, s) : a;
    }
    return h('span', { class: 'v', text: truncate(s, 400) });
}

function treeNode(key, value, depth) {
    if (value && typeof value === 'object') {
        const isArr = Array.isArray(value);
        const entries = isArr ? value.map((v, i) => [i, v]) : Object.entries(value).filter(([k]) => k !== '@context');
        let hint = isArr ? `[${value.length}]` : `{${entries.length}}`;
        if (!isArr && entries.length === 1 && value['@id']) {
            hint = `→ ${truncate(String(value['@id']), 60)}`; // reference to another entity
        } else if (!isArr && value['@type']) {
            const name = typeof value.name === 'string' ? value.name : typeof value.text === 'string' ? value.text : '';
            hint = name ? `${typeLabel(value['@type'])} · ${truncate(name, 50)}` : typeLabel(value['@type']);
        }
        return h('details', { open: depth < 1 },
            h('summary', {}, h('span', { class: 'k', text: key }), h('span', { class: 'meta-hint', text: hint })),
            h('div', { class: 'branch' }, entries.map(([k, v]) => treeNode(k, v, depth + 1))));
    }
    return h('div', { class: 'leaf' }, h('span', { class: 'k', text: key }), leafValue(value));
}

function entityCard(e) {
    const raw = h('pre', { class: 'raw', hidden: true, text: JSON.stringify(e.data, null, 2) });
    const copyBtn = h('button', {
        class: 'btn-sm',
        text: 'Copy JSON',
        onclick: () => navigator.clipboard.writeText(JSON.stringify(e.data, null, 2))
            .then(() => { copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy JSON'; }, 1200); })
            .catch(() => { copyBtn.textContent = 'Copy failed'; }),
    });
    const rawBtn = h('button', {
        class: 'btn-sm',
        text: 'Raw',
        onclick: () => { raw.hidden = !raw.hidden; rawBtn.textContent = raw.hidden ? 'Raw' : 'Tree'; tree.hidden = !raw.hidden; },
    });
    const entries = Object.entries(e.data).filter(([k]) => !['@context', '@type', '@id'].includes(k));
    const tree = h('div', { class: 'tree' }, entries.map(([k, v]) => treeNode(k, v, 0)));

    return card(
        h('div', { class: 'card-head' },
            chip(e.type || 'no @type', e.type ? 'accent' : 'warn'),
            h('div', { class: 'card-title' }, e.id ? h('span', { class: 'card-sub', text: truncate(String(e.id), 60) }) : null),
            muted(e.source), copyBtn, rawBtn),
        e.missing.length ? h('div', { class: 'pills', style: 'margin-bottom:8px' }, e.missing.map((p) => chip(`missing ${p}`, 'warn'))) : null,
        tree,
        raw,
    );
}

function renderSchema(d) {
    const { jsonld, microdata, entityCount } = d.schema;
    const enc = encodeURIComponent(d.url);
    const types = schemaTypes(d);

    const summary = card(
        cardHead('Structured data', muted(`${plural(jsonld.length, 'JSON-LD block')} · ${plural(microdata.length, 'microdata item')}`)),
        types.length ? h('div', { class: 'pills', style: 'margin-bottom:12px' }, types.map(([t, n]) => chip(n > 1 ? `${t} ×${n}` : t, 'accent'))) : null,
        h('div', { class: 'pills' },
            h('a', { class: 'pill', href: `https://search.google.com/test/rich-results?url=${enc}`, target: '_blank', rel: 'noopener noreferrer', text: 'Google Rich Results Test' }),
            h('a', { class: 'pill', href: `https://validator.schema.org/#url=${enc}`, target: '_blank', rel: 'noopener noreferrer', text: 'Schema.org validator' })),
    );

    if (!jsonld.length && !microdata.length) {
        return [summary, card(empty('No structured data found', 'Add JSON-LD (recommended by Google) to make the page eligible for rich results.'))];
    }

    const out = [summary];
    if (jsonld.length) {
        out.push(h('div', { class: 'section-label', text: 'JSON-LD' }));
        jsonld.forEach((b) => {
            if (b.error) {
                out.push(card(
                    h('div', { class: 'card-head' }, chip('invalid JSON', 'err'), h('div', { class: 'card-title', text: `JSON-LD #${b.index + 1}` })),
                    h('div', { class: 'item-sub', text: b.error }),
                    h('pre', { class: 'raw', text: truncate(b.raw, 5000) }),
                ));
            } else if (!b.entities.length) {
                out.push(card(h('div', { class: 'card-head' }, chip('empty', 'warn'), h('div', { class: 'card-title', text: `JSON-LD #${b.index + 1}` }))));
            } else {
                b.entities.forEach((e) => out.push(entityCard({ ...e, source: `JSON-LD #${b.index + 1}` })));
            }
        });
    }
    if (microdata.length) {
        out.push(h('div', { class: 'section-label', text: 'Microdata' }));
        microdata.forEach((e) => out.push(entityCard({ ...e, source: 'Microdata' })));
    }
    if (entityCount === 0 && !jsonld.some((b) => b.error)) out.push(muted('No entities found.'));
    return out;
}

const RENDERERS = {
    overview: renderOverview,
    meta: renderMeta,
    headings: renderHeadings,
    images: renderImages,
    links: renderLinks,
    schema: renderSchema,
};

/* ================================================================ navigation */

function go(tab) {
    if (!TABS.includes(tab)) return;
    state.tab = tab;
    try { localStorage.setItem(STORAGE_KEY, tab); } catch { /* ignore */ }
    render();
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.rail-btn').forEach((btn) => btn.addEventListener('click', () => go(btn.dataset.tab)));
    $('#refresh').addEventListener('click', analyze);
    analyze();
});
