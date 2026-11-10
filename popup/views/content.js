import { h, card, cardHead, chip, muted, empty, meter, levelChip, formatBytes } from '../dom.js';
import { issuesFor } from '../state.js';

function stat(label, value, note, cls) {
    return h('div', { class: `tile static ${cls || ''}` },
        h('span', { class: 'tile-label', text: label }),
        h('span', { class: 'tile-value', text: value }),
        note ? h('span', { class: 'tile-note', text: note }) : null);
}

function termList(title, terms, note) {
    const max = terms[0]?.count || 1;
    return card(
        cardHead(title, muted(note)),
        terms.length
            ? h('div', { class: 'list' }, terms.map((t) => h('div', { class: 'item' },
                h('div', { class: 'item-body' },
                    h('div', { class: 'item-title', text: t.term }),
                    meter(t.count, max)),
                h('div', { class: 'item-chips' }, chip(`${t.count}×`), chip(`${t.density}%`, 'info')))))
            : muted('Not enough repeated terms.'),
    );
}

export function renderContent(d) {
    const c = d.content;
    const issues = issuesFor('content');
    return [
        h('div', { class: 'grid grid-3' },
            stat('Words', c.wordCount, `~${c.readingMinutes} min read`, c.wordCount < 300 ? 'warn' : 'ok'),
            stat('Text / HTML', `${c.textHtmlRatio}%`, `${formatBytes(c.textLength)} text of ${formatBytes(c.htmlLength)} HTML`, c.textHtmlRatio < 10 ? 'warn' : ''),
            stat('Measured in', `<${c.source || '—'}>`, 'excl. nav, header, footer, aside')),
        issues.length ? card(cardHead('Checks'), h('div', { class: 'list' }, issues.map((i) => h('div', { class: 'item' }, levelChip(i.level), h('div', { class: 'item-body', text: i.message }))))) : null,
        c.wordCount
            ? [termList('Top terms', c.keywords, `stopwords removed${c.lang ? ` · page lang: ${c.lang}` : ''}`), termList('Top phrases', c.phrases, 'two-word phrases')]
            : card(empty('No text content', 'The main content area has no readable text.')),
    ];
}
