/*
 * page.js — everything that runs code inside the inspected tab
 * (chrome.scripting.executeScript wrappers).
 */
/* global analyzePage */
import { state } from './state.js';

export async function runAnalyzer(tabId) {
    // Always (re)inject: picks up the current analyzer after an extension reload.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['analyzer.js'] });
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: () => analyzePage() });
    if (!res?.result) throw new Error('No result from page');
    return res.result;
}

/* Injected into the page: scroll to the nth element matching selector and flash an outline. */
function pageScrollTo(selector, index) {
    const el = document.querySelectorAll(selector)[index];
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const { outline, outlineOffset } = el.style;
    el.style.outline = '3px solid #ef4444';
    el.style.outlineOffset = '3px';
    setTimeout(() => { el.style.outline = outline; el.style.outlineOffset = outlineOffset; }, 2000);
    return true;
}

export function scrollInPage(selector, index) {
    chrome.scripting.executeScript({ target: { tabId: state.tabId }, func: pageScrollTo, args: [selector, index] })
        .catch(() => {});
}

/* Overlay (overlay.js) — returns the list of active modes. */
export async function setOverlay(mode, on) {
    const target = { tabId: state.tabId };
    await chrome.scripting.executeScript({ target, files: ['overlay.js'] });
    const [res] = await chrome.scripting.executeScript({
        target,
        func: (m, o) => window.__htmlseoOverlay.toggle(m, o),
        args: [mode, on],
    });
    return res?.result || [];
}

export async function getOverlayModes() {
    try {
        const [res] = await chrome.scripting.executeScript({
            target: { tabId: state.tabId },
            func: () => window.__htmlseoOverlay?.modes() || [],
        });
        return res?.result || [];
    } catch {
        return [];
    }
}
