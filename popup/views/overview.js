import { h, card, cardHead, chip, muted, empty, plural, truncate, levelChip } from '../dom.js';
import { state, go, allIssues, issuesFor } from '../state.js';
import { indexVerdict } from './indexing.js';
import { schemaTypes } from './schema.js';

function tile(label, value, cls, note, tab) {
    return h('button', { class: `tile ${cls || ''}`, onclick: tab ? () => go(tab) : null },
        h('span', { class: 'tile-label', text: label }),
        h('span', { class: 'tile-value', text: value }),
        note ? h('span', { class: 'tile-note', text: note }) : null);
}

export function renderOverview(d) {
    const errs = issuesFor(null, 'error').length;
    const warns = issuesFor(null, 'warning').length;
    const h1 = d.headings.filter((x) => x.level === 1).length;
    const noAlt = d.images.filter((i) => !i.hasAlt).length;
    const perf = d.images.filter((i) => (i.oversized && !i.hidden) || i.heavy || (i.lazy && i.aboveFold)).length;
    const internal = d.links.filter((l) => l.kind === 'internal').length;
    const external = d.links.filter((l) => l.kind === 'external').length;
    const types = schemaTypes(d);
    const verdict = indexVerdict(d);

    const order = { error: 0, warning: 1, info: 2 };
    const issues = [...allIssues()].sort((a, b) => order[a.level] - order[b.level]);

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
        state.pageChanged ? h('div', { class: 'banner' }, 'The page navigated to a new URL.', h('button', { class: 'btn-sm', text: 'Re-analyze', onclick: () => document.getElementById('refresh').click() })) : null,
        h('div', { class: 'grid grid-3' },
            tile('Errors', errs, errs ? 'err' : 'ok', errs ? 'Fix these first' : 'No errors'),
            tile('Warnings', warns, warns ? 'warn' : 'ok', plural(issuesFor(null, 'info').length, 'note')),
            tile('Indexing', verdict.short, verdict.cls, verdict.note, 'indexing'),
            tile('H1 headings', h1, h1 === 1 ? 'ok' : h1 ? 'warn' : 'err', `${plural(d.headings.length, 'heading')} total`, 'headings'),
            tile('Images without alt', noAlt, noAlt ? 'warn' : 'ok', `${plural(perf, 'perf issue')} · ${d.images.length} total`, 'images'),
            tile('Links', `${internal} / ${external}`, '', 'internal / external', 'links'),
            tile('Words', d.content.wordCount, d.content.wordCount < 300 ? 'warn' : '', `~${d.content.readingMinutes} min read`, 'content'),
            tile('Schema entities', d.schema.entityCount, d.schema.entityCount ? 'ok' : '', types.length ? truncate(types.map(([t]) => t).join(', '), 40) : 'None found', 'schema'),
            tile('Title width', `${d.meta.titlePx}px`, d.meta.titlePx > d.meta.titleMaxPx ? 'warn' : d.meta.title ? 'ok' : 'err', `of ~${d.meta.titleMaxPx}px in Google`, 'meta')),
        card(
            cardHead('Issues', muted(plural(issues.length, 'item'))),
            issues.length
                ? h('div', { class: 'list' }, issues.map((i) => h('div', { class: 'item clickable', onclick: () => go(i.section) },
                    levelChip(i.level),
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
