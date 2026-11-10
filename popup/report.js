/*
 * report.js — export the current analysis as Markdown or JSON.
 */
import { state, allIssues } from './state.js';

const ORDER = { error: 0, warning: 1, info: 2 };
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function reportObject() {
    const d = state.data;
    return {
        generatedBy: `HTML SEO ${chrome.runtime.getManifest?.().version || ''}`.trim(),
        generatedAt: new Date().toISOString(),
        url: d.url,
        issues: allIssues(),
        meta: d.meta,
        content: d.content,
        headings: d.headings,
        images: d.images,
        links: d.links,
        schema: d.schema,
        server: state.server,
        robots: state.robots,
        sitemap: state.sitemap,
        linkCheck: state.linkCheck ? { checked: state.linkCheck.done, results: state.linkCheck.results } : null,
    };
}

export function toJSON() {
    return JSON.stringify(reportObject(), null, 2);
}

export function toMarkdown() {
    const d = state.data;
    const m = d.meta;
    const issues = [...allIssues()].sort((a, b) => ORDER[a.level] - ORDER[b.level]);
    const count = (lvl) => issues.filter((i) => i.level === lvl).length;
    const lines = [];
    const push = (...l) => lines.push(...l);

    push(`# SEO report: ${m.title || d.url}`, '', `- **URL:** ${d.url}`, `- **Date:** ${new Date().toLocaleString()}`,
        `- **Errors:** ${count('error')} · **Warnings:** ${count('warning')} · **Notes:** ${count('info')}`, '');

    push('## Issues', '');
    if (!issues.length) push('No issues found.', '');
    else push(...issues.map((i) => `- **${i.level}** (${i.section}) ${i.message}`), '');

    push('## Meta', '', '| Tag | Value |', '|---|---|',
        `| Title | ${esc(m.title)} (${m.titleLength} chars, ${m.titlePx}px) |`,
        `| Description | ${esc(m.description || '—')} (${m.descriptionLength} chars) |`,
        `| Canonical | ${esc(m.canonical || '—')} |`,
        `| Robots | ${esc(m.robots || 'not set')} |`,
        `| Lang | ${esc(m.lang || '—')} |`,
        `| og:image | ${esc(m.ogImage || '—')} |`, '');

    if (state.server?.status === 'done' && !state.server.error) {
        const s = state.server;
        push('## Indexing', '', `- **HTTP status:** ${s.httpStatus}`);
        if (s.chain?.length) push(`- **Redirects:** ${s.chain.map((c) => `${c.statusCode} ${c.url}`).join(' → ')} → ${s.finalUrl}`);
        if (s.headers?.['x-robots-tag']) push(`- **X-Robots-Tag:** ${s.headers['x-robots-tag']}`);
        if (state.robots?.verdict) push(`- **robots.txt:** ${state.robots.verdict.allowed ? 'allowed' : `blocked by \`${state.robots.verdict.rule.pattern}\``}`);
        push('');
    }

    push('## Content', '', `- ${d.content.wordCount} words, ~${d.content.readingMinutes} min read, text/HTML ${d.content.textHtmlRatio}%`);
    if (d.content.keywords.length) push(`- Top terms: ${d.content.keywords.map((k) => `${k.term} (${k.count})`).join(', ')}`);
    push('');

    push('## Headings', '');
    if (!d.headings.length) push('None.');
    d.headings.forEach((x) => push(`${'  '.repeat(x.level - 1)}- ${x.tag}: ${x.text || '(empty)'}`));
    push('');

    const noAlt = d.images.filter((i) => !i.hasAlt).length;
    const internal = d.links.filter((l) => l.kind === 'internal').length;
    const external = d.links.filter((l) => l.kind === 'external').length;
    push('## Images & links', '', `- ${d.images.length} images, ${noAlt} without alt`, `- ${d.links.length} links (${internal} internal, ${external} external)`);
    if (state.linkCheck?.done) {
        const broken = Object.entries(state.linkCheck.results).filter(([, r]) => !r.ok);
        push(`- Link check: ${state.linkCheck.done} checked, ${broken.length} broken`);
        broken.slice(0, 50).forEach(([url, r]) => push(`  - ${r.status || r.error}: ${url}`));
    }
    push('');

    const types = [...d.schema.jsonld.flatMap((b) => b.entities), ...d.schema.microdata].map((e) => e.type || '(no @type)');
    push('## Structured data', '', types.length ? `- ${types.join(', ')}` : '- None', '');

    return lines.join('\n');
}

export function download(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function reportFileName(ext) {
    let host = 'page';
    try { host = new URL(state.data.url).host.replace(/[^a-z0-9.-]/gi, '_'); } catch { /* ignore */ }
    return `seo-${host}-${new Date().toISOString().slice(0, 10)}.${ext}`;
}
