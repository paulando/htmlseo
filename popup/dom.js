/*
 * dom.js — tiny, safe DOM helpers for the popup.
 * Page data is untrusted: h() only sets textContent/attributes, never HTML.
 */

export function h(tag, props, ...children) {
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

export function safeUrl(url) {
    try {
        const u = new URL(url);
        return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
    } catch {
        return null;
    }
}

export function link(url, text = url) {
    const href = safeUrl(url);
    if (!href) return h('span', { text });
    return h('a', { href, target: '_blank', rel: 'noopener noreferrer', text, onclick: (e) => e.stopPropagation() });
}

export const chip = (text, cls = '') => h('span', { class: `chip ${cls}`.trim(), text });
export const card = (...children) => h('div', { class: 'card' }, ...children);
export const cardHead = (title, ...extra) => h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: title }), ...extra);
export const kv = (key, ...val) => h('div', { class: 'kv' }, h('div', { class: 'kv-key', text: key }), h('div', { class: 'kv-val' }, ...val));
export const muted = (text) => h('span', { class: 'card-sub', text });
export const empty = (title, text) => h('div', { class: 'empty' }, h('div', { class: 'empty-title', text: title }), text ? h('div', { text }) : null);
export const truncate = (s, n) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const isImageUrl = (s) => /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(s);
export const levelChip = (level) => chip(level, level);

export function fileName(src) {
    try {
        return decodeURIComponent(new URL(src).pathname.split('/').pop()) || src;
    } catch {
        return String(src || '');
    }
}

export function formatBytes(n) {
    if (n == null) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/* Image hover preview (uses the single #preview element in popup.html). */
export function attachPreview(el, src) {
    const url = safeUrl(src);
    if (!url) return el;
    const preview = document.getElementById('preview');
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

/* Filter pill group. options: [value, label, count][] */
export function filterPills(current, options, onChange) {
    return h('div', { class: 'pills' }, options.map(([value, label, count]) => h('button', {
        class: 'pill',
        'aria-pressed': String(current === value),
        onclick: () => onChange(value),
    }, label, count != null ? h('span', { class: 'count', text: count }) : null)));
}

/* A pressed/unpressed toggle pill. */
export function togglePill(label, pressed, onToggle) {
    return h('button', { class: 'pill toggle', 'aria-pressed': String(!!pressed), onclick: () => onToggle(!pressed) }, label);
}

export function limited(items, renderItem, limit = 500) {
    const shown = items.slice(0, limit).map(renderItem);
    if (items.length > limit) shown.push(h('div', { class: 'item' }, muted(`Showing first ${limit} of ${items.length}.`)));
    return shown;
}

/* Text width in px with a canvas (same approach as analyzer.js). */
const canvas = document.createElement('canvas').getContext('2d');
export function textWidth(text, font) {
    canvas.font = font;
    return canvas.measureText(text || '').width;
}

/* Cut text so it fits maxPx (adds an ellipsis), the way Google truncates. */
export function truncateToPx(text, maxPx, font) {
    if (!text || textWidth(text, font) <= maxPx) return { text: text || '', truncated: false };
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (textWidth(`${text.slice(0, mid)} …`, font) <= maxPx) lo = mid; else hi = mid - 1;
    }
    return { text: `${text.slice(0, lo).trimEnd()} …`, truncated: true };
}

export function meter(value, max, cls) {
    const pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
    return h('div', { class: `meter ${cls || ''}` }, h('i', { style: `width:${pct}%` }));
}

export function flash(el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('flash');
    void el.offsetWidth; // restart animation
    el.classList.add('flash');
}
