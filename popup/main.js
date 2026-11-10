/*
 * main.js — popup entry point (ES module).
 * Runs the analyzer in the inspected tab, kicks off network checks, wires the
 * rail/topbar and renders the active view.
 *
 * SAFETY RULE: page data is untrusted — build DOM with h() from dom.js only.
 */
import { h, card, empty, safeUrl } from './dom.js';
import { state, setRenderer, rerender, go, loadSettings, issuesFor } from './state.js';
import { runAnalyzer, getOverlayModes } from './page.js';
import { getServerInfo, getRobots, getSitemap } from './net.js';
import { toMarkdown, toJSON, download, reportFileName } from './report.js';
import { renderOverview } from './views/overview.js';
import { renderMeta } from './views/meta.js';
import { renderContent } from './views/content.js';
import { renderHeadings } from './views/headings.js';
import { renderImages } from './views/images.js';
import { renderLinks, linkCacheKey } from './views/links.js';
import { renderSchema } from './views/schema.js';
import { renderIndexing } from './views/indexing.js';
import { renderSettings } from './views/settings.js';

const RENDERERS = {
    overview: renderOverview,
    meta: renderMeta,
    content: renderContent,
    headings: renderHeadings,
    images: renderImages,
    links: renderLinks,
    schema: renderSchema,
    indexing: renderIndexing,
    settings: renderSettings,
};

const $ = (sel, root = document) => root.querySelector(sel);
let analysisId = 0;

/* ================================================================ render */

function render() {
    $('#settings-btn').setAttribute('aria-pressed', String(state.tab === 'settings'));
    if (!state.data) {
        if (state.tab === 'settings') $('#view').replaceChildren(...renderSettings());
        return;
    }
    const d = state.data;
    $('#page-title').textContent = d.meta.title || '(no title)';
    $('#page-url').textContent = d.url;

    document.querySelectorAll('.rail-btn').forEach((btn) => {
        const tab = btn.dataset.tab;
        btn.setAttribute('aria-current', tab === state.tab ? 'page' : 'false');
        const pill = $('.rail-pill', btn);
        const section = tab === 'overview' ? null : tab;
        const errs = issuesFor(section, 'error').length;
        const warns = tab === 'overview' ? 0 : issuesFor(section, 'warning').length;
        pill.hidden = !errs && !warns;
        pill.textContent = errs || warns;
        pill.classList.toggle('warn', !errs);
    });

    const view = $('#view');
    const scrollTop = view.dataset.tab === state.tab ? view.scrollTop : 0;
    // Renderers may return arrays containing null for optional cards; drop them
    // (replaceChildren would otherwise insert the text "null").
    view.replaceChildren(...[RENDERERS[state.tab](d)].flat(Infinity).filter(Boolean));
    view.dataset.tab = state.tab;
    view.scrollTop = scrollTop;
}

function renderUnavailable(err) {
    $('#page-title').textContent = 'Page can’t be analyzed';
    $('#page-url').textContent = '';
    document.querySelectorAll('.rail-pill').forEach((p) => { p.hidden = true; });
    if (state.tab === 'settings') { render(); return; }
    $('#view').replaceChildren(card(empty(
        'This page can’t be analyzed',
        'Chrome doesn’t allow extensions on chrome:// pages, the Web Store, or some built-in viewers. On a normal page, try reloading the tab.',
    ), h('div', { class: 'card-sub', style: 'text-align:center', text: err?.message || '' })));
}

/* ================================================================ analysis */

function resetChecks() {
    state.server = null;
    state.robots = null;
    state.sitemap = null;
    state.linkCheck?.controller?.abort();
    state.linkCheck = null;
    state.hreflangCheck?.controller?.abort();
    state.hreflangCheck = null;
    state.ogImageSize = null;
    state.pageChanged = false;
}

async function analyze() {
    const id = ++analysisId;
    const refresh = $('#refresh');
    refresh.classList.add('spinning');
    resetChecks();
    let data;
    try {
        data = await runAnalyzer(state.tabId);
    } catch (e) {
        if (id === analysisId) { state.data = null; renderUnavailable(e); }
        return;
    } finally {
        refresh.classList.remove('spinning');
    }
    if (id !== analysisId) return;
    state.data = data;
    render();

    restoreLinkCheck(id);
    loadOgImageSize(id);
    getOverlayModes().then((modes) => { if (id === analysisId) { state.overlay = modes; rerender(); } });
    await runServerChecks(id);
}

function updateBadge() {
    const count = issuesFor(null, 'error').length;
    chrome.runtime.sendMessage({ type: 'popupCount', tabId: state.tabId, count })?.catch?.(() => {});
}

async function runServerChecks(id) {
    const url = state.data.url;
    if (!safeUrl(url)) {
        updateBadge();
        return;
    }
    state.server = { status: 'loading' };
    state.robots = { status: 'loading' };
    rerender();

    const settle = (p) => p.then((r) => ({ status: 'done', ...r })).catch((e) => ({ status: 'done', error: e?.message || String(e) }));
    const [server, robots] = await Promise.all([settle(getServerInfo(state.tabId, url)), settle(getRobots(url))]);
    if (id !== analysisId) return;
    state.server = server;
    state.robots = robots;
    updateBadge();
    rerender();

    const listed = robots.sitemaps?.[0];
    const sitemapUrl = listed || `${new URL(url).origin}/sitemap.xml`;
    state.sitemap = { status: 'loading', url: sitemapUrl };
    rerender();
    const sm = await settle(getSitemap(sitemapUrl, url));
    if (id !== analysisId) return;
    state.sitemap = { ...sm, url: sm.url || sitemapUrl, guessed: !listed };
    if (!listed && sm.httpStatus >= 400) state.sitemap.note = 'No sitemap at /sitemap.xml and none listed in robots.txt.';
    updateBadge();
    rerender();
}

async function restoreLinkCheck(id) {
    try {
        const key = linkCacheKey(state.data.url);
        const cached = (await chrome.storage.session.get(key))[key];
        if (cached && id === analysisId && !state.linkCheck) {
            state.linkCheck = { running: false, done: cached.done, total: cached.total, results: cached.results };
            rerender();
        }
    } catch { /* ignore */ }
}

function loadOgImageSize(id) {
    const src = safeUrl(state.data.meta.ogImage || '');
    if (!src) return;
    const img = new Image();
    img.onload = () => { if (id === analysisId) { state.ogImageSize = { width: img.naturalWidth, height: img.naturalHeight }; rerender(); } };
    img.onerror = () => { if (id === analysisId) { state.ogImageSize = { error: true }; rerender(); } };
    img.src = src;
}

/* ================================================================ topbar */

function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 1600);
}

function bindExportMenu() {
    const btn = $('#export-btn');
    const menu = $('#export-menu');
    const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.hidden = !menu.hidden;
        btn.setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.addEventListener('click', (e) => { if (!menu.contains(e.target)) close(); });
    menu.addEventListener('click', async (e) => {
        const action = e.target.closest('[data-export]')?.dataset.export;
        if (!action) return;
        close();
        if (!state.data) { toast('Nothing to export'); return; }
        try {
            if (action === 'copy-md') { await navigator.clipboard.writeText(toMarkdown()); toast('Markdown copied'); }
            if (action === 'copy-json') { await navigator.clipboard.writeText(toJSON()); toast('JSON copied'); }
            if (action === 'dl-md') download(reportFileName('md'), toMarkdown(), 'text/markdown');
            if (action === 'dl-json') download(reportFileName('json'), toJSON(), 'application/json');
        } catch (err) {
            toast(`Export failed: ${err.message}`);
        }
    });
}

/* ================================================================ boot */

async function boot() {
    setRenderer(render);
    await loadSettings();

    const paramTab = Number(new URLSearchParams(location.search).get('tabId'));
    if (paramTab) {
        state.tabId = paramTab;
        document.documentElement.classList.add('detached');
        $('#popout').hidden = true;
    } else {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        state.tabId = tab?.id;
    }

    document.querySelectorAll('.rail-btn').forEach((btn) => btn.addEventListener('click', () => go(btn.dataset.tab)));
    $('#refresh').addEventListener('click', analyze);
    $('#settings-btn').addEventListener('click', () => go(state.tab === 'settings' ? 'overview' : 'settings'));
    $('#popout').addEventListener('click', async () => {
        await chrome.windows.create({ url: chrome.runtime.getURL(`popup.html?tabId=${state.tabId}`), type: 'popup', width: 760, height: 660 });
        window.close();
    });
    bindExportMenu();

    // SPA route change in the inspected tab (sent by content.js).
    chrome.runtime.onMessage.addListener((msg, sender) => {
        if (msg?.type !== 'pageChanged' || sender.tab?.id !== state.tabId) return;
        if (state.settings.spaReanalyze) analyze();
        else { state.pageChanged = true; rerender(); }
    });

    analyze();
}

boot();
