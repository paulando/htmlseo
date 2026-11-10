import { h, card, cardHead, chip, muted, empty, link, limited, safeUrl, attachPreview, filterPills, togglePill, truncate, fileName, formatBytes } from '../dom.js';
import { state, rerender } from '../state.js';
import { scrollInPage } from '../page.js';
import { toggleOverlay } from './overlay-toggle.js';

const hasPerfIssue = (i) => (i.oversized && !i.hidden) || i.heavy || (i.lazy && i.aboveFold);

export function renderImages(d) {
    const groups = {
        all: d.images,
        missing: d.images.filter((i) => !i.hasAlt),
        decorative: d.images.filter((i) => i.decorative),
        perf: d.images.filter(hasPerfIssue),
        nodims: d.images.filter((i) => !i.hasDims && !i.hidden),
        lazy: d.images.filter((i) => i.lazy),
    };
    const list = groups[state.filters.images] || d.images;
    const setFilter = (v) => { state.filters.images = v; rerender(); };

    return card(
        cardHead('Images', togglePill('Highlight alt on page', state.overlay.includes('alt'), (on) => toggleOverlay('alt', on))),
        h('div', { style: 'margin-bottom:10px' }, filterPills(state.filters.images, [
            ['all', 'All', groups.all.length],
            ['missing', 'Missing alt', groups.missing.length],
            ['decorative', 'Decorative', groups.decorative.length],
            ['perf', 'Performance', groups.perf.length],
            ['nodims', 'No width/height', groups.nodims.length],
            ['lazy', 'Lazy', groups.lazy.length],
        ], setFilter)),
        list.length
            ? h('div', { class: 'list' }, limited(list, (img) => {
                const src = safeUrl(img.src);
                const name = img.src ? fileName(img.src) : '(no src)';
                return h('div', { class: 'item clickable', title: 'Scroll to image', onclick: () => scrollInPage('img', img.index) },
                    attachPreview(h('img', { class: 'thumb', src, alt: '', loading: 'lazy' }), img.src),
                    h('div', { class: 'item-body' },
                        h('div', { class: 'item-title' }, img.hasAlt ? (img.alt || muted('alt="" (decorative)')) : chip('no alt attribute', 'warn')),
                        h('div', { class: 'item-sub' }, src ? link(img.src, truncate(name, 70)) : truncate(name, 70)),
                        h('div', { class: 'item-sub' },
                            img.width ? `${img.width}×${img.height} file` : '',
                            img.renderedW ? ` · shown ${img.renderedW}×${img.renderedH}` : '')),
                    h('div', { class: 'item-chips' },
                        img.lcpCandidate ? chip('LCP candidate', 'accent') : null,
                        img.oversized && !img.hidden ? chip(`oversized ${img.oversized}×`, 'warn') : null,
                        img.bytes ? chip(formatBytes(img.bytes), img.heavy ? 'warn' : '') : null,
                        img.lazy && img.aboveFold ? chip('lazy above fold', 'warn') : img.lazy ? chip('lazy', 'info') : null,
                        !img.hasDims && !img.hidden ? chip('no dims', 'info') : null,
                        img.hidden ? chip('hidden') : null));
            }))
            : empty('No images', state.filters.images === 'all' ? 'This page has no <img> elements.' : 'Nothing matches this filter.'),
    );
}
