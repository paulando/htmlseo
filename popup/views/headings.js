import { h, card, cardHead, chip, muted, empty, limited, togglePill, levelChip } from '../dom.js';
import { state, issuesFor } from '../state.js';
import { scrollInPage } from '../page.js';
import { toggleOverlay } from './overlay-toggle.js';

export function renderHeadings(d) {
    const counts = [1, 2, 3, 4, 5, 6].map((l) => [l, d.headings.filter((x) => x.level === l).length]).filter(([, n]) => n);
    const issues = issuesFor('headings');
    return [
        issues.length ? card(cardHead('Checks'), h('div', { class: 'list' }, issues.map((i) => h('div', { class: 'item' }, levelChip(i.level), h('div', { class: 'item-body', text: i.message }))))) : null,
        card(
            cardHead('Outline',
                h('div', { class: 'pills' }, counts.map(([l, n]) => chip(`H${l} · ${n}`, l === 1 ? 'accent' : ''))),
                togglePill('Show on page', state.overlay.includes('headings'), (on) => toggleOverlay('headings', on))),
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
