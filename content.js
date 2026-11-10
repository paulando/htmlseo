/*
 * content.js — runs automatically on every page (manifest "content_scripts"),
 * after analyzer.js. Its only job is to keep the toolbar badge in sync with the
 * number of errors on the page. The popup does its own fresh analysis.
 */
(() => {
    try {
        const count = analyzePage().issues.filter((i) => i.level === 'error').length;
        chrome.runtime.sendMessage({ type: 'updateCount', count })?.catch?.(() => {});
    } catch (e) {
        // Never break the host page.
    }
})();
