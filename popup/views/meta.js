import { h, card, cardHead, chip, kv, link, muted, plural, safeUrl, isImageUrl, attachPreview, truncateToPx, meter, truncate } from '../dom.js';
import { state, rerender } from '../state.js';
import { checkHreflangReturn, pool } from '../net.js';

function lengthInfo(len, min, max) {
    const cls = !len ? 'err' : len < min || len > max ? 'warn' : 'ok';
    return [chip(`${len} chars`, cls), meter(len, max * 1.25, cls)];
}

function pxInfo(px, max) {
    const cls = px > max ? 'warn' : 'ok';
    return [chip(`${px} / ${max}px`, cls), meter(px, max * 1.25, cls)];
}

function serpCard(d) {
    const m = d.meta;
    let crumbs = '';
    try {
        const u = new URL(d.url);
        crumbs = [u.host, ...u.pathname.split('/').filter(Boolean)].join(' › ');
    } catch { /* ignore */ }
    const t = truncateToPx(m.title || '(no title)', m.titleMaxPx, m.titleFont);
    const desc = truncateToPx(m.description || 'No meta description — Google will pick text from the page.', m.descMaxPx, m.descFont);
    return card(
        cardHead('Search preview', t.truncated ? chip('title truncated', 'warn') : null, desc.truncated ? chip('description truncated', 'warn') : null, muted('approximate')),
        h('div', { class: 'serp' },
            h('div', { class: 'serp-url', text: crumbs }),
            h('div', { class: 'serp-title', text: t.text }),
            h('div', { class: 'serp-desc', text: desc.text })),
    );
}

/* ---- social previews (generic mock-ups, not platform branding) ---- */

function socialData(d) {
    const m = d.meta;
    const og = Object.fromEntries(m.og.map((t) => [t.prop, t.content]));
    const tw = Object.fromEntries(m.twitter.map((t) => [t.prop, t.content]));
    let host = '';
    try { host = new URL(d.url).host.replace(/^www\./, ''); } catch { /* ignore */ }
    return {
        host,
        og: { title: og.title || m.title, description: og.description || m.description, image: m.ogImage },
        tw: {
            card: tw.card || 'summary',
            title: tw.title || og.title || m.title,
            description: tw.description || og.description || m.description,
            image: safeUrl(tw.image || tw['image:src'] || '') || m.ogImage,
        },
    };
}

function socialImage(src, cls) {
    const url = safeUrl(src);
    return url
        ? h('img', { class: `social-img ${cls || ''}`, src: url, alt: '', loading: 'lazy' })
        : h('div', { class: `social-img ${cls || ''} social-img-missing`, text: 'No image' });
}

function socialCard(label, layout, { image, host, title, description }) {
    const body = h('div', { class: 'social-body' },
        h('div', { class: 'social-host', text: host.toUpperCase() }),
        h('div', { class: 'social-title', text: truncate(title || '(no title)', 110) }),
        description ? h('div', { class: 'social-desc', text: truncate(description, 200) }) : null);
    return h('div', { class: 'social' },
        h('div', { class: 'social-label', text: label }),
        h('div', { class: `social-card ${layout}` }, socialImage(image, layout === 'side' ? 'square' : ''), body));
}

function socialPreviews(d) {
    const s = socialData(d);
    const size = state.ogImageSize;
    let sizeChip = null;
    if (d.meta.ogImage && size?.width) {
        const small = size.width < 1200 || size.height < 630;
        sizeChip = chip(`${size.width}×${size.height}${small ? ' · below 1200×630' : ''}`, small ? 'warn' : 'ok');
    } else if (d.meta.ogImage && size?.error) {
        sizeChip = chip('og:image failed to load', 'err');
    }
    return card(
        cardHead('Social previews', sizeChip, muted('approximate')),
        h('div', { class: 'social-grid' },
            socialCard('Facebook-style', 'large', { image: s.og.image, host: s.host, title: s.og.title, description: s.og.description }),
            socialCard(`X-style · ${s.tw.card}`, s.tw.card === 'summary_large_image' ? 'large' : 'side', { image: s.tw.image, host: s.host, title: s.tw.title, description: s.tw.card === 'summary_large_image' ? null : s.tw.description }),
            socialCard('LinkedIn-style', 'large compact', { image: s.og.image, host: s.host, title: s.og.title, description: null })),
    );
}

/* ---- hreflang ---- */

async function runHreflangCheck(d) {
    const alts = d.meta.hreflang.filter((x) => !x.self && safeUrl(x.href)).slice(0, 20);
    const controller = new AbortController();
    state.hreflangCheck = { running: true, results: {}, controller };
    rerender();
    await pool(alts, async (alt) => {
        state.hreflangCheck.results[alt.href] = await checkHreflangReturn(alt, d.url, controller.signal);
        rerender(true);
    }, { concurrency: 4, signal: controller.signal });
    state.hreflangCheck.running = false;
    rerender();
}

function hreflangCard(d) {
    const list = d.meta.hreflang;
    if (!list.length) return null;
    const check = state.hreflangCheck;
    const resultChip = (x) => {
        if (x.self) return chip('this page', 'accent');
        const r = check?.results[x.href];
        if (!r) return check?.running ? chip('checking…') : null;
        return r.ok ? chip(`links back${r.returnLang ? ` as ${r.returnLang}` : ''}`, 'ok') : chip(r.reason, 'err');
    };
    return card(
        cardHead('Hreflang', muted(plural(list.length, 'alternate')),
            h('button', { class: 'btn-sm', disabled: check?.running || null, onclick: () => runHreflangCheck(d), text: check?.running ? 'Checking…' : 'Check return links' })),
        list.map((x) => kv(x.lang || '(empty)',
            link(x.href),
            !x.valid ? chip('invalid code', 'warn') : null,
            x.relative ? chip('relative', 'info') : null,
            resultChip(x))),
    );
}

/* ---- view ---- */

export function renderMeta(d) {
    const m = d.meta;
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
        serpCard(d),
        card(
            cardHead('Meta tags'),
            kv('Title', m.title || chip('missing', 'err'), m.title ? h('div', { class: 'kv-meters' }, h('div', {}, pxInfo(m.titlePx, m.titleMaxPx)), h('div', {}, lengthInfo(m.titleLength, 30, 60))) : null),
            kv('Description', m.description || chip('missing', 'err'), m.description ? h('div', { class: 'kv-meters' }, h('div', {}, lengthInfo(m.descriptionLength, 70, 160))) : null),
            kv('Canonical', m.canonical ? link(m.canonical) : null, canonicalChip),
            kv('Robots', m.robots || muted('not set (defaults to index, follow)'), robotsChip),
            m.googlebot ? kv('Googlebot', m.googlebot) : null,
            kv('Lang', m.lang || chip('missing', 'warn')),
            kv('Viewport', m.viewport || chip('missing', 'warn')),
            kv('Charset', m.charset || chip('missing', 'info')),
        ),
        hreflangCard(d),
        socialPreviews(d),
        card(
            cardHead('Open Graph', m.ogImage ? null : chip('no og:image', 'err')),
            m.og.length ? tagRows(m.og) : muted('No Open Graph tags.'),
        ),
        card(
            cardHead('Twitter'),
            m.twitter.length ? tagRows(m.twitter) : muted('No Twitter card tags (Open Graph is used as a fallback).'),
        ),
    ];
}
