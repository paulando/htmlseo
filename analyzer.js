/*
 * analyzer.js — runs inside the inspected page (content-script isolated world).
 *
 * Exposes exactly ONE global: analyzePage(). It returns plain, structured-cloneable
 * data (no HTML). The popup renders it; content.js only uses it for the badge count.
 *
 * This file is injected more than once into the same page (as a content script and
 * again by the popup), so do NOT add top-level `const`/`let`/`class` declarations —
 * a second injection would throw "Identifier has already been declared".
 * Keep everything inside analyzePage().
 */
function analyzePage() {
    const doc = document;
    const loc = window.location;
    const issues = [];
    const add = (level, section, message) => issues.push({ level, section, message });

    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const metaContent = (selector) => {
        const el = doc.querySelector(selector);
        return el ? clean(el.getAttribute('content')) : null;
    };
    const isHidden = (el) => {
        if (typeof el.checkVisibility === 'function') return !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
        return el.offsetParent === null;
    };
    const stripHost = (h) => h.toLowerCase().replace(/^www\./, '');
    const TRACKING = /^(utm_|gclid$|fbclid$|msclkid$|mc_|_ga$|ref$)/i;
    const normalizeUrl = (href) => {
        try {
            const u = new URL(href, loc.href);
            u.hash = '';
            [...u.searchParams.keys()].forEach((k) => { if (TRACKING.test(k)) u.searchParams.delete(k); });
            const path = u.pathname.replace(/\/+$/, '') || '/';
            return `${u.protocol}//${stripHost(u.host)}${path}${u.search}`;
        } catch {
            return href;
        }
    };

    /* ------------------------------------------------------------------ META */

    const title = clean(doc.title);
    const description = metaContent('meta[name="description" i]');
    const canonicalEls = [...doc.querySelectorAll('link[rel="canonical" i]')];
    const canonical = canonicalEls[0]?.href || null;
    const canonicalMatches = canonical ? normalizeUrl(canonical) === normalizeUrl(loc.href) : null;
    const robots = metaContent('meta[name="robots" i]');
    const googlebot = metaContent('meta[name="googlebot" i]');
    const lang = doc.documentElement.getAttribute('lang');
    const viewport = metaContent('meta[name="viewport" i]');
    const charset = doc.querySelector('meta[charset]')?.getAttribute('charset')
        || (doc.querySelector('meta[http-equiv="content-type" i]') ? 'via http-equiv' : null);
    const hreflang = [...doc.querySelectorAll('link[rel="alternate" i][hreflang]')]
        .map((l) => ({ lang: l.getAttribute('hreflang'), href: l.href }));
    const og = [...doc.querySelectorAll('meta[property^="og:" i]')]
        .map((m) => ({ prop: m.getAttribute('property').slice(3), content: clean(m.getAttribute('content')) }));
    const twitter = [...doc.querySelectorAll('meta[name^="twitter:" i], meta[property^="twitter:" i]')]
        .map((m) => ({ prop: (m.getAttribute('name') || m.getAttribute('property')).slice(8), content: clean(m.getAttribute('content')) }));
    const ogImage = og.find((t) => t.prop === 'image')?.content || null;

    if (!title) add('error', 'meta', 'Missing <title>.');
    else if (title.length < 30 || title.length > 60) add('warning', 'meta', `Title is ${title.length} characters (aim for 30–60).`);
    if (doc.querySelectorAll('title:not(svg title)').length > 1) add('warning', 'meta', 'More than one <title> element.');

    if (!description) add('error', 'meta', 'Missing meta description.');
    else if (description.length < 70 || description.length > 160) add('warning', 'meta', `Description is ${description.length} characters (aim for 70–160).`);
    if (doc.querySelectorAll('meta[name="description" i]').length > 1) add('warning', 'meta', 'More than one meta description.');

    if (!canonical) add('warning', 'meta', 'No canonical link.');
    else if (!canonicalMatches) add('warning', 'meta', 'Canonical points to a different URL.');
    if (canonicalEls.length > 1) add('error', 'meta', `${canonicalEls.length} canonical links found (only one allowed).`);

    const robotsAll = `${robots || ''},${googlebot || ''}`.toLowerCase();
    if (/\bnoindex\b|\bnone\b/.test(robotsAll)) add('error', 'meta', `Page is set to noindex (${[robots, googlebot].filter(Boolean).join(' / ')}).`);
    else if (/\bnofollow\b/.test(robotsAll)) add('warning', 'meta', 'Page is set to nofollow.');

    if (!lang) add('warning', 'meta', 'Missing lang attribute on <html>.');
    if (!viewport) add('warning', 'meta', 'Missing viewport meta tag.');
    if (!charset) add('info', 'meta', 'No charset declaration found.');

    if (!ogImage) add('error', 'meta', 'Missing og:image.');
    if (!og.some((t) => t.prop === 'title')) add('warning', 'meta', 'Missing og:title.');
    if (!og.some((t) => t.prop === 'description')) add('info', 'meta', 'Missing og:description.');
    if (!twitter.some((t) => t.prop === 'card')) add('info', 'meta', 'Missing twitter:card.');

    /* -------------------------------------------------------------- HEADINGS */

    let prevLevel = 0;
    let skips = 0;
    const headings = [...doc.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((el, index) => {
        const level = Number(el.tagName[1]);
        const skip = prevLevel > 0 && level > prevLevel + 1;
        if (skip) skips++;
        prevLevel = level;
        return { tag: el.tagName, level, text: clean(el.textContent), index, hidden: isHidden(el), skip };
    });
    const h1s = headings.filter((h) => h.level === 1);
    if (!h1s.length) add('error', 'headings', 'No H1 found.');
    else if (h1s.length > 1) add('warning', 'headings', `${h1s.length} H1 headings found.`);
    if (h1s.length && h1s.every((h) => h.hidden)) add('warning', 'headings', 'H1 is hidden.');
    if (skips) add('warning', 'headings', `Heading level skipped ${skips}× (e.g. H2 → H4).`);
    const emptyHeadings = headings.filter((h) => !h.text).length;
    if (emptyHeadings) add('warning', 'headings', `${emptyHeadings} empty heading(s).`);

    /* ---------------------------------------------------------------- IMAGES */

    const images = [...doc.querySelectorAll('img')].map((el, index) => {
        const lazySrc = el.dataset.src || el.dataset.lazySrc || el.dataset.original || '';
        const src = el.currentSrc || el.src || (lazySrc ? new URL(lazySrc, loc.href).href : '');
        const hasAlt = el.hasAttribute('alt');
        const alt = hasAlt ? clean(el.getAttribute('alt')) : null;
        return {
            index,
            src,
            alt,
            hasAlt,
            decorative: hasAlt && alt === '',
            width: el.naturalWidth || null,
            height: el.naturalHeight || null,
            lazy: el.loading === 'lazy' || !!lazySrc,
            hidden: isHidden(el),
        };
    });
    const missingAlt = images.filter((i) => !i.hasAlt).length;
    if (missingAlt) add('warning', 'images', `${missingAlt} image(s) missing the alt attribute.`);

    /* ----------------------------------------------------------------- LINKS */

    const host = stripHost(loc.host);
    const links = [...doc.querySelectorAll('a')].map((el, index) => {
        const rawHref = el.getAttribute('href');
        const rel = (el.getAttribute('rel') || '').toLowerCase();
        const target = el.getAttribute('target') || '';
        const text = clean(el.textContent)
            || clean(el.getAttribute('aria-label'))
            || clean(el.querySelector('img[alt]')?.getAttribute('alt'))
            || clean(el.getAttribute('title'));
        let kind;
        const trimmed = (rawHref || '').trim();
        if (!trimmed) kind = 'empty';
        else if (trimmed.startsWith('#')) kind = 'anchor';
        else if (/^javascript:/i.test(trimmed)) kind = 'js';
        else {
            try {
                const u = new URL(el.href);
                if (u.protocol === 'mailto:') kind = 'mailto';
                else if (u.protocol === 'tel:') kind = 'tel';
                else if (u.protocol === 'http:' || u.protocol === 'https:') kind = stripHost(u.host) === host ? 'internal' : 'external';
                else kind = 'other';
            } catch {
                kind = 'other';
            }
        }
        return {
            index,
            href: el.href || '',
            rawHref,
            text,
            kind,
            target,
            rel,
            nofollow: /\b(nofollow|ugc|sponsored)\b/.test(rel),
        };
    });
    const noText = links.filter((l) => !l.text && l.kind !== 'empty').length;
    if (noText) add('warning', 'links', `${noText} link(s) without anchor text.`);
    const emptyLinks = links.filter((l) => l.kind === 'empty' || l.kind === 'js').length;
    if (emptyLinks) add('info', 'links', `${emptyLinks} link(s) with an empty or javascript: href.`);
    const extNoRel = links.filter((l) => l.kind === 'external' && !l.rel).length;
    if (extNoRel) add('info', 'links', `${extNoRel} external link(s) without a rel attribute.`);

    /* ---------------------------------------------------------------- SCHEMA */

    // Recommended (not exhaustive) properties per type. "a|b" = at least one of them.
    const SCHEMA_RULES = {
        Article: ['headline', 'image', 'datePublished', 'author'],
        NewsArticle: ['headline', 'image', 'datePublished', 'author'],
        BlogPosting: ['headline', 'image', 'datePublished', 'author'],
        Product: ['name', 'image', 'offers|review|aggregateRating'],
        Offer: ['price|priceSpecification', 'priceCurrency|priceSpecification'],
        Organization: ['name', 'url', 'logo'],
        LocalBusiness: ['name', 'address'],
        BreadcrumbList: ['itemListElement'],
        FAQPage: ['mainEntity'],
        WebSite: ['name', 'url'],
        WebPage: ['name|headline'],
        Person: ['name'],
        Event: ['name', 'startDate', 'location'],
        Recipe: ['name', 'image'],
        Review: ['itemReviewed', 'reviewRating', 'author'],
        VideoObject: ['name', 'thumbnailUrl', 'uploadDate'],
        JobPosting: ['title', 'description', 'datePosted', 'hiringOrganization'],
        HowTo: ['name', 'step'],
        SoftwareApplication: ['name', 'offers|aggregateRating'],
    };
    const typesOf = (obj) => [].concat(obj?.['@type'] || []).map(String);
    const shortType = (t) => String(t).replace(/^https?:\/\/schema\.org\//i, '');
    const missingFor = (obj) => {
        const missing = [];
        typesOf(obj).map(shortType).forEach((t) => {
            (SCHEMA_RULES[t] || []).forEach((rule) => {
                const opts = rule.split('|');
                if (!opts.some((p) => obj[p] !== undefined && obj[p] !== null && obj[p] !== '')) missing.push(opts.join(' or '));
            });
        });
        return [...new Set(missing)];
    };
    const flatten = (node) => {
        if (Array.isArray(node)) return node.flatMap(flatten);
        if (!node || typeof node !== 'object') return [];
        if (Array.isArray(node['@graph'])) return flatten(node['@graph']);
        return [node];
    };

    const jsonld = [...doc.querySelectorAll('script[type="application/ld+json" i]')].map((s, i) => {
        const raw = (s.textContent || '').trim();
        const block = { index: i, raw, error: null, context: null, entities: [] };
        try {
            const parsed = JSON.parse(raw);
            block.context = [].concat(parsed?.['@context'] || (Array.isArray(parsed) ? parsed[0]?.['@context'] : null) || [])
                .filter((c) => typeof c === 'string').join(', ') || null;
            block.entities = flatten(parsed).map((data) => {
                const type = typesOf(data).map(shortType).join(', ') || null;
                const missing = missingFor(data);
                if (!type) add('warning', 'schema', `JSON-LD block #${i + 1} has an entity without @type.`);
                if (missing.length) add('warning', 'schema', `${type} is missing recommended: ${missing.join(', ')}.`);
                return { type, id: data['@id'] || null, missing, data };
            });
            if (!block.context) add('warning', 'schema', `JSON-LD block #${i + 1} has no @context.`);
        } catch (e) {
            block.error = e.message;
            add('error', 'schema', `JSON-LD block #${i + 1} is not valid JSON: ${e.message}`);
        }
        return block;
    });

    const MICRO_LIMIT = 50;
    const microValue = (el) => {
        const tag = el.tagName;
        if (tag === 'META') return el.getAttribute('content') || '';
        if (['LINK', 'A', 'AREA'].includes(tag)) return el.href || '';
        if (['IMG', 'AUDIO', 'VIDEO', 'SOURCE', 'IFRAME', 'EMBED', 'TRACK'].includes(tag)) return el.src || '';
        if (tag === 'TIME') return el.getAttribute('datetime') || clean(el.textContent);
        if (['DATA', 'METER'].includes(tag)) return el.getAttribute('value') || '';
        if (tag === 'OBJECT') return el.data || '';
        return clean(el.textContent).slice(0, 500);
    };
    const readMicrodata = (scope, depth = 0) => {
        const out = {};
        const itemtype = scope.getAttribute('itemtype');
        if (itemtype) out['@type'] = itemtype.split(/\s+/).map(shortType).join(', ');
        if (scope.getAttribute('itemid')) out['@id'] = scope.getAttribute('itemid');
        scope.querySelectorAll('[itemprop]').forEach((p) => {
            // Only direct properties of this scope (not of a nested item).
            if (p.parentElement?.closest('[itemscope]') !== scope) return;
            const value = p.hasAttribute('itemscope') && depth < 8 ? readMicrodata(p, depth + 1) : microValue(p);
            p.getAttribute('itemprop').split(/\s+/).filter(Boolean).forEach((name) => {
                out[name] = name in out ? [].concat(out[name], value) : value;
            });
        });
        return out;
    };
    const microdata = [...doc.querySelectorAll('[itemscope]:not([itemprop])')].slice(0, MICRO_LIMIT).map((el) => {
        const data = readMicrodata(el);
        const missing = missingFor(data);
        const type = data['@type'] || null;
        if (missing.length) add('warning', 'schema', `${type || 'Microdata item'} (microdata) is missing recommended: ${missing.join(', ')}.`);
        return { type, id: data['@id'] || null, missing, data };
    });

    const entityCount = jsonld.reduce((n, b) => n + b.entities.length, 0) + microdata.length;
    if (!jsonld.length && !microdata.length) add('info', 'schema', 'No structured data (JSON-LD or microdata) found.');

    return {
        url: loc.href,
        origin: loc.origin,
        analyzedAt: Date.now(),
        meta: {
            title, titleLength: title.length,
            description, descriptionLength: description?.length || 0,
            canonical, canonicalMatches, canonicalCount: canonicalEls.length,
            robots, googlebot, lang, viewport, charset,
            hreflang, og, ogImage, twitter,
        },
        headings,
        images,
        links,
        schema: { jsonld, microdata, entityCount },
        issues,
    };
}
