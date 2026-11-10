/*
 * analyzer.js — runs inside the inspected page (content-script isolated world).
 *
 * Exposes exactly ONE global: analyzePage(). It returns plain, structured-cloneable
 * data (no HTML). The popup renders it; content.js only uses it for the badge count.
 *
 * This file is injected more than once into the same page (as a content script and
 * again by the popup), so do NOT add top-level `const`/`let`/`class` declarations —
 * a second injection would throw "Identifier has already been declared".
 * Keep everything inside analyzePage(). (ESLint enforces this.)
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
    /*
     * Visibility = checkVisibility() (display/visibility/opacity) + not clipped away by an
     * ancestor's overflow (collapsed menus: max-height:0; overflow:hidden, carousels…)
     * + not horizontally off-screen (off-canvas drawers).
     * overlay.js has a compact copy of clippedByAncestor — keep them in sync.
     */
    const styles = new Map();
    const styleOf = (el) => {
        let cs = styles.get(el);
        if (!cs) { cs = getComputedStyle(el); styles.set(el, cs); }
        return cs;
    };
    const containsPaint = (cs) => /paint|strict|content/.test(cs.contain);
    const formsContainingBlock = (cs) => cs.transform !== 'none' || cs.filter !== 'none' || /paint|layout|strict|content/.test(cs.contain);
    const clippedByAncestor = (el, rect) => {
        let { top, left, bottom, right } = rect;
        // An empty intersection means clipped; a zero-size element (e.g. unloaded lazy
        // image) only counts as clipped when it lies strictly outside.
        const emptyX = rect.width > 0 ? (r, l) => r <= l : (r, l) => r < l;
        const emptyY = rect.height > 0 ? (b, t) => b <= t : (b, t) => b < t;
        let pos = styleOf(el).position;
        for (let p = el.parentElement; p && p !== doc.documentElement; p = p.parentElement) {
            const cs = styleOf(p);
            // Fixed/absolute boxes are only clipped by ancestors in their containing-block chain.
            if (pos === 'fixed' && !formsContainingBlock(cs)) continue;
            if (pos === 'absolute' && cs.position === 'static' && !formsContainingBlock(cs)) continue;
            const clipX = cs.overflowX !== 'visible' || containsPaint(cs);
            const clipY = cs.overflowY !== 'visible' || containsPaint(cs);
            if (clipX || clipY) {
                const r = p.getBoundingClientRect();
                if (clipX) {
                    left = Math.max(left, r.left);
                    right = Math.min(right, r.right);
                    if (r.width < 1 || emptyX(right, left)) return true;
                }
                if (clipY) {
                    top = Math.max(top, r.top);
                    bottom = Math.min(bottom, r.bottom);
                    if (r.height < 1 || emptyY(bottom, top)) return true;
                }
            }
            pos = cs.position;
        }
        return false;
    };
    const isHidden = (el, rect = el.getBoundingClientRect()) => {
        if (typeof el.checkVisibility === 'function') {
            if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return true;
        } else if (el.offsetParent === null) {
            return true;
        }
        if (rect.width > 0 && (rect.right <= 0 || rect.left >= window.innerWidth)) return true;
        return clippedByAncestor(el, rect);
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
    const ctx = doc.createElement('canvas').getContext('2d');
    const measure = (text, font) => {
        if (!ctx || !text) return 0;
        ctx.font = font;
        return Math.round(ctx.measureText(text).width);
    };
    const fileName = (src) => {
        try { return decodeURIComponent(new URL(src).pathname.split('/').pop()) || src; } catch { return src; }
    };

    /* ------------------------------------------------------------------ META */

    const TITLE_FONT = '20px Arial';
    const TITLE_MAX_PX = 580;
    const DESC_FONT = '14px Arial';
    const DESC_MAX_PX = 920;

    const title = clean(doc.title);
    const titlePx = measure(title, TITLE_FONT);
    const description = metaContent('meta[name="description" i]');
    const descPx = measure(description, DESC_FONT);
    const canonicalEls = [...doc.querySelectorAll('link[rel="canonical" i]')];
    const canonical = canonicalEls[0]?.href || null;
    const canonicalMatches = canonical ? normalizeUrl(canonical) === normalizeUrl(loc.href) : null;
    const robots = metaContent('meta[name="robots" i]');
    const googlebot = metaContent('meta[name="googlebot" i]');
    const lang = doc.documentElement.getAttribute('lang');
    const viewport = metaContent('meta[name="viewport" i]');
    const charset = doc.querySelector('meta[charset]')?.getAttribute('charset')
        || (doc.querySelector('meta[http-equiv="content-type" i]') ? 'via http-equiv' : null);
    const og = [...doc.querySelectorAll('meta[property^="og:" i]')]
        .map((m) => ({ prop: m.getAttribute('property').slice(3), content: clean(m.getAttribute('content')) }));
    const twitter = [...doc.querySelectorAll('meta[name^="twitter:" i], meta[property^="twitter:" i]')]
        .map((m) => ({ prop: (m.getAttribute('name') || m.getAttribute('property')).slice(8), content: clean(m.getAttribute('content')) }));
    const ogImageRaw = og.find((t) => t.prop === 'image' || t.prop === 'image:url')?.content || null;
    let ogImage = null;
    try { ogImage = ogImageRaw ? new URL(ogImageRaw, loc.href).href : null; } catch { /* invalid */ }

    if (!title) add('error', 'meta', 'Missing <title>.');
    else {
        if (titlePx > TITLE_MAX_PX) add('warning', 'meta', `Title is ${titlePx}px wide; Google truncates around ${TITLE_MAX_PX}px.`);
        if (title.length < 30) add('warning', 'meta', `Title is only ${title.length} characters (aim for 30+).`);
    }
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

    if (!ogImageRaw) add('error', 'meta', 'Missing og:image.');
    else {
        if (!/^https?:\/\//i.test(ogImageRaw)) add('warning', 'meta', 'og:image is a relative URL; social networks need an absolute URL.');
        if (!og.some((t) => t.prop === 'image:alt')) add('info', 'meta', 'Missing og:image:alt.');
    }
    if (!og.some((t) => t.prop === 'title')) add('warning', 'meta', 'Missing og:title.');
    if (!og.some((t) => t.prop === 'description')) add('info', 'meta', 'Missing og:description.');
    if (!twitter.some((t) => t.prop === 'card')) add('info', 'meta', 'Missing twitter:card.');

    /* -------------------------------------------------------------- HREFLANG */

    const HREFLANG_RE = /^(x-default|[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?)$/i;
    const hreflang = [...doc.querySelectorAll('link[rel="alternate" i][hreflang]')].map((l) => {
        const code = (l.getAttribute('hreflang') || '').trim();
        const rawHref = l.getAttribute('href') || '';
        return {
            lang: code,
            href: l.href,
            valid: HREFLANG_RE.test(code),
            self: normalizeUrl(l.href) === normalizeUrl(loc.href),
            relative: !/^https?:\/\//i.test(rawHref),
        };
    });
    if (hreflang.length) {
        const invalid = hreflang.filter((x) => !x.valid);
        if (invalid.length) add('warning', 'meta', `Invalid hreflang code(s): ${invalid.map((x) => x.lang || '(empty)').join(', ')}.`);
        const seen = new Map();
        hreflang.forEach((x) => seen.set(x.lang.toLowerCase(), (seen.get(x.lang.toLowerCase()) || 0) + 1));
        const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
        if (dupes.length) add('warning', 'meta', `Duplicate hreflang value(s): ${dupes.join(', ')}.`);
        if (!hreflang.some((x) => x.self)) add('warning', 'meta', 'Hreflang set has no self-referencing entry.');
        if (!hreflang.some((x) => x.lang.toLowerCase() === 'x-default')) add('warning', 'meta', 'Hreflang set has no x-default.');
        if (hreflang.some((x) => x.relative)) add('info', 'meta', 'Hreflang uses relative URLs (absolute URLs are recommended).');
    }

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

    const dpr = window.devicePixelRatio || 1;
    const foldY = window.innerHeight;
    const scrollY = window.scrollY;
    const preloaded = new Set([...doc.querySelectorAll('link[rel="preload" i][as="image" i][href]')].map((l) => l.href));
    const images = [...doc.querySelectorAll('img')].map((el, index) => {
        const lazySrc = el.dataset.src || el.dataset.lazySrc || el.dataset.original || '';
        let src = el.currentSrc || el.src || '';
        if (!src && lazySrc) { try { src = new URL(lazySrc, loc.href).href; } catch { /* ignore */ } }
        const hasAlt = el.hasAttribute('alt');
        const alt = hasAlt ? clean(el.getAttribute('alt')) : null;
        const rect = el.getBoundingClientRect();
        const renderedW = Math.round(rect.width);
        const renderedH = Math.round(rect.height);
        const hidden = isHidden(el, rect);
        const width = el.naturalWidth || null;
        const height = el.naturalHeight || null;
        const isSvg = /\.svg(\?|#|$)/i.test(src) || src.startsWith('data:image/svg');
        const oversizeRatio = !isSvg && width && renderedW > 0 ? width / (renderedW * dpr) : null;
        const entry = src ? performance.getEntriesByName(src)[0] : null;
        const bytes = entry ? (entry.encodedBodySize || entry.transferSize || null) : null;
        return {
            index,
            src,
            alt,
            hasAlt,
            decorative: hasAlt && alt === '',
            width,
            height,
            renderedW,
            renderedH,
            hasDims: el.hasAttribute('width') && el.hasAttribute('height'),
            // Not-yet-loaded lazy images can have 0 height; position still tells us where they sit.
            aboveFold: !hidden && (renderedW > 0 || renderedH > 0) && rect.top + scrollY < foldY,
            lazy: el.loading === 'lazy' || !!lazySrc,
            fetchpriority: (el.getAttribute('fetchpriority') || '').toLowerCase() || null,
            preloaded: preloaded.has(src),
            oversized: oversizeRatio && oversizeRatio >= 1.5 && width > 200 ? Math.round(oversizeRatio * 10) / 10 : null,
            bytes,
            heavy: bytes ? bytes > 300 * 1024 : false,
            hidden,
        };
    });
    const missingAlt = images.filter((i) => !i.hasAlt).length;
    if (missingAlt) add('warning', 'images', `${missingAlt} image(s) missing the alt attribute.`);
    const oversized = images.filter((i) => i.oversized && !i.hidden).length;
    if (oversized) add('warning', 'images', `${oversized} image(s) are much larger than their displayed size.`);
    const heavy = images.filter((i) => i.heavy).length;
    if (heavy) add('warning', 'images', `${heavy} image(s) are over 300 KB.`);
    const lazyAbove = images.filter((i) => i.lazy && i.aboveFold).length;
    if (lazyAbove) add('warning', 'images', `${lazyAbove} above-the-fold image(s) are lazy-loaded (hurts LCP).`);
    const noDims = images.filter((i) => !i.hasDims && !i.hidden).length;
    if (noDims) add('info', 'images', `${noDims} image(s) without width/height attributes (risk of layout shift).`);
    // Only images of meaningful size (≥ 200×200 px area) are realistic LCP elements.
    const lcp = images.filter((i) => i.aboveFold && i.renderedW * i.renderedH >= 40000)
        .sort((a, b) => b.renderedW * b.renderedH - a.renderedW * a.renderedH)[0];
    if (lcp) {
        lcp.lcpCandidate = true;
        if (lcp.fetchpriority !== 'high' && !lcp.preloaded) {
            add('info', 'images', `Largest above-the-fold image (${fileName(lcp.src)}) has no fetchpriority="high" or preload.`);
        }
    }

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

    /* --------------------------------------------------------------- CONTENT */

    const EXCLUDE = new Set(['NAV', 'HEADER', 'FOOTER', 'ASIDE', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'FORM']);
    const contentRoot = doc.querySelector('main, [role="main"]') || doc.querySelector('article') || doc.body;
    const chunks = [];
    if (contentRoot) {
        const walker = doc.createTreeWalker(contentRoot, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
            acceptNode: (n) => (n.nodeType === 1 && (EXCLUDE.has(n.tagName.toUpperCase()) || n.getAttribute('role') === 'navigation')
                ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
        });
        let total = 0;
        while (walker.nextNode() && total < 2_000_000) {
            if (walker.currentNode.nodeType === 3) {
                chunks.push(walker.currentNode.nodeValue);
                total += walker.currentNode.nodeValue.length;
            }
        }
    }
    const mainText = clean(chunks.join(' '));
    const words = (mainText.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).slice(0, 200000);
    const STOP = new Set(('a about above after again against all also am an and any are as at be because been before being below between both but by '
        + 'can could did do does doing down during each few for from further get got had has have having he her here hers him his how i if in into is it '
        + 'its itself just let me more most my no nor not now of off on once only or other our ours out over own same she should so some such than that '
        + 'the their them then there these they this those through to too under until up very was we were what when where which while who whom why will '
        + 'with would you your yours one two may might must shall us via per new use used using like make made many much well').split(' '));
    const keep = (w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w);
    const counts = new Map();
    const pairs = new Map();
    words.forEach((w, i) => {
        if (keep(w)) counts.set(w, (counts.get(w) || 0) + 1);
        const next = words[i + 1];
        if (next && keep(w) && keep(next)) pairs.set(`${w} ${next}`, (pairs.get(`${w} ${next}`) || 0) + 1);
    });
    const top = (map, min) => [...map.entries()].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([term, count]) => ({ term, count, density: words.length ? Math.round((count / words.length) * 1000) / 10 : 0 }));
    const htmlLength = doc.documentElement.outerHTML.length;
    const firstH1 = h1s[0]?.text || '';
    const content = {
        source: contentRoot ? (contentRoot === doc.body ? 'body' : contentRoot.tagName.toLowerCase()) : null,
        wordCount: words.length,
        readingMinutes: Math.max(1, Math.round(words.length / 230)),
        textLength: mainText.length,
        htmlLength,
        textHtmlRatio: htmlLength ? Math.round((mainText.length / htmlLength) * 1000) / 10 : 0,
        keywords: top(counts, 2),
        phrases: top(pairs, 2),
        titleEqualsH1: !!title && !!firstH1 && title.toLowerCase() === firstH1.toLowerCase(),
        lang,
    };
    if (content.wordCount < 300) add('info', 'content', `Thin content: ${content.wordCount} words in the main content.`);
    if (content.textHtmlRatio < 10) add('info', 'content', `Low text-to-HTML ratio (${content.textHtmlRatio}%).`);
    if (content.titleEqualsH1) add('info', 'content', 'Title and H1 are identical (consider varying them).');

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
    const isRef = (obj) => obj && typeof obj === 'object' && !Array.isArray(obj) && obj['@id'] && Object.keys(obj).length === 1;
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

    const definedIds = new Set();
    const referencedIds = new Set();
    const walkIds = (node, depth = 0) => {
        if (!node || typeof node !== 'object' || depth > 20) return;
        if (Array.isArray(node)) { node.forEach((n) => walkIds(n, depth + 1)); return; }
        if (node['@id']) (isRef(node) ? referencedIds : definedIds).add(String(node['@id']));
        Object.values(node).forEach((v) => walkIds(v, depth + 1));
    };

    const jsonld = [...doc.querySelectorAll('script[type="application/ld+json" i]')].map((s, i) => {
        const raw = (s.textContent || '').trim();
        const block = { index: i, raw, error: null, context: null, entities: [] };
        try {
            const parsed = JSON.parse(raw);
            walkIds(parsed);
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

    const danglingRefs = [...referencedIds].filter((id) => !definedIds.has(id)).map((id) => {
        let sameSite = true;
        try { sameSite = stripHost(new URL(id, loc.href).host) === host; } catch { /* keep */ }
        add(sameSite ? 'warning' : 'info', 'schema', `@id reference "${id}" is not defined on this page.`);
        return { id, sameSite };
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
            title, titleLength: title.length, titlePx, titleMaxPx: TITLE_MAX_PX, titleFont: TITLE_FONT,
            description, descriptionLength: description?.length || 0, descPx, descMaxPx: DESC_MAX_PX, descFont: DESC_FONT,
            canonical, canonicalMatches, canonicalCount: canonicalEls.length,
            robots, googlebot, lang, viewport, charset,
            hreflang, og, ogImage, twitter,
        },
        headings,
        images,
        links,
        content,
        schema: { jsonld, microdata, entityCount, danglingRefs, definedIds: [...definedIds] },
        issues,
    };
}
