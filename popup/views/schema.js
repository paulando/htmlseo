import { h, card, cardHead, chip, muted, empty, link, plural, safeUrl, attachPreview, truncate, isImageUrl, flash } from '../dom.js';

export function schemaEntities(d) {
    return [
        ...d.schema.jsonld.flatMap((b) => b.entities.map((e) => ({ ...e, source: `JSON-LD #${b.index + 1}` }))),
        ...d.schema.microdata.map((e) => ({ ...e, source: 'Microdata' })),
    ];
}

export function schemaTypes(d) {
    const counts = new Map();
    schemaEntities(d).forEach((e) => (e.type || '(no @type)').split(', ').forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
    return [...counts.entries()];
}

const typeLabel = (t) => [].concat(t).map((x) => String(x).replace(/^https?:\/\/schema\.org\//i, '')).join(', ');
const isRef = (v) => v && typeof v === 'object' && !Array.isArray(v) && v['@id'] && Object.keys(v).length === 1;

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

/* A {"@id": …} reference: jump to the entity card that defines it, or flag it. */
function refValue(id, ctx) {
    const key = String(id);
    if (ctx.idCards.has(key) || ctx.defined.has(key)) {
        return h('button', {
            class: 'ref-btn',
            title: 'Go to the referenced entity',
            onclick: () => { const target = ctx.idCards.get(key); if (target) flash(target); },
        }, `→ ${truncate(key, 70)}`);
    }
    return h('span', { class: 'v' }, `→ ${truncate(key, 70)} `, chip('not defined on page', ctx.dangling.get(key) ? 'warn' : 'info'));
}

function treeNode(key, value, depth, ctx) {
    if (isRef(value)) return h('div', { class: 'leaf' }, h('span', { class: 'k', text: key }), refValue(value['@id'], ctx));
    if (value && typeof value === 'object') {
        const isArr = Array.isArray(value);
        const entries = isArr ? value.map((v, i) => [i, v]) : Object.entries(value).filter(([k]) => k !== '@context');
        let hint = isArr ? `[${value.length}]` : `{${entries.length}}`;
        if (!isArr && value['@type']) {
            const name = typeof value.name === 'string' ? value.name : typeof value.text === 'string' ? value.text : '';
            hint = name ? `${typeLabel(value['@type'])} · ${truncate(name, 50)}` : typeLabel(value['@type']);
        }
        return h('details', { open: depth < 1 },
            h('summary', {}, h('span', { class: 'k', text: key }), h('span', { class: 'meta-hint', text: hint })),
            h('div', { class: 'branch' }, entries.map(([k, v]) => treeNode(k, v, depth + 1, ctx))));
    }
    return h('div', { class: 'leaf' }, h('span', { class: 'k', text: key }), leafValue(value));
}

function entityCard(e, ctx) {
    const raw = h('pre', { class: 'raw', hidden: true, text: JSON.stringify(e.data, null, 2) });
    const entries = Object.entries(e.data).filter(([k]) => !['@context', '@type', '@id'].includes(k));
    const tree = h('div', { class: 'tree' }, entries.map(([k, v]) => treeNode(k, v, 0, ctx)));
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

    const el = card(
        h('div', { class: 'card-head' },
            chip(e.type || 'no @type', e.type ? 'accent' : 'warn'),
            h('div', { class: 'card-title' }, e.id ? h('span', { class: 'card-sub', text: truncate(String(e.id), 60) }) : null),
            muted(e.source), copyBtn, rawBtn),
        e.missing.length ? h('div', { class: 'pills', style: 'margin-bottom:8px' }, e.missing.map((p) => chip(`missing ${p}`, 'warn'))) : null,
        tree,
        raw,
    );
    if (e.id && !ctx.idCards.has(String(e.id))) ctx.idCards.set(String(e.id), el);
    return el;
}

export function renderSchema(d) {
    const { jsonld, microdata, entityCount, danglingRefs = [], definedIds = [] } = d.schema;
    const enc = encodeURIComponent(d.url);
    const types = schemaTypes(d);
    const ctx = {
        idCards: new Map(),
        defined: new Set(definedIds),
        dangling: new Map(danglingRefs.map((r) => [r.id, r.sameSite])),
    };

    const summary = card(
        cardHead('Structured data', muted(`${plural(jsonld.length, 'JSON-LD block')} · ${plural(microdata.length, 'microdata item')}`)),
        types.length ? h('div', { class: 'pills', style: 'margin-bottom:12px' }, types.map(([t, n]) => chip(n > 1 ? `${t} ×${n}` : t, 'accent'))) : null,
        danglingRefs.length ? h('div', { class: 'pills', style: 'margin-bottom:12px' }, danglingRefs.map((r) => chip(`undefined @id ${truncate(r.id, 40)}`, r.sameSite ? 'warn' : 'info'))) : null,
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
                b.entities.forEach((e) => out.push(entityCard({ ...e, source: `JSON-LD #${b.index + 1}` }, ctx)));
            }
        });
    }
    if (microdata.length) {
        out.push(h('div', { class: 'section-label', text: 'Microdata' }));
        microdata.forEach((e) => out.push(entityCard({ ...e, source: 'Microdata' }, ctx)));
    }
    if (entityCount === 0 && !jsonld.some((b) => b.error)) out.push(muted('No entities found.'));
    return out;
}
