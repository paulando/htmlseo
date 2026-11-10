import { h, card, cardHead, muted } from '../dom.js';
import { state, saveSetting, rerender } from '../state.js';

function toggle(key, label, help) {
    return h('label', { class: 'setting' },
        h('div', { class: 'setting-text' }, h('div', { class: 'setting-label', text: label }), muted(help)),
        h('input', {
            type: 'checkbox',
            class: 'switch',
            checked: state.settings[key] || null,
            onchange: (e) => { saveSetting(key, e.target.checked); rerender(); },
        }));
}

function number(key, label, help, min, max) {
    return h('label', { class: 'setting' },
        h('div', { class: 'setting-text' }, h('div', { class: 'setting-label', text: label }), muted(help)),
        h('input', {
            type: 'number',
            class: 'num-input',
            min,
            max,
            value: state.settings[key],
            onchange: (e) => {
                const v = Math.max(min, Math.min(max, Number(e.target.value) || min));
                e.target.value = v;
                saveSetting(key, v);
            },
        }));
}

export function renderSettings() {
    const version = chrome.runtime.getManifest?.().version || '';
    return [
        card(
            cardHead('Badge & analysis'),
            toggle('autoBadge', 'Show error badge automatically',
                'Analyzes every page you open so the toolbar icon shows its error count. Turn off to analyze only when you open this popup.'),
            toggle('spaReanalyze', 'Re-analyze on in-page navigation',
                'For single-page apps: refresh the popup automatically when the URL changes without a page load.'),
        ),
        card(
            cardHead('Link checker'),
            number('linkCheckLimit', 'Max URLs per check', 'Unique http(s) links checked per run (10–2000).', 10, 2000),
            number('linkCheckConcurrency', 'Parallel requests', 'How many links are checked at the same time (1–12).', 1, 12),
        ),
        card(
            cardHead('About'),
            muted(`HTML SEO ${version}. Network checks (robots.txt, sitemap, link and hreflang checks) are sent from your browser without cookies, only when you open the popup or press a check button. No data leaves your browser otherwise.`),
        ),
    ];
}
