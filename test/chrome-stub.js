/*
 * DEV ONLY — fakes the chrome.* APIs that popup.js uses, so the popup can run in a
 * normal browser tab next to a test page. Loaded by test/harness.html, never shipped.
 * The "active tab" is the #page iframe in the harness (must be same-origin).
 */
(() => {
    const pageWindow = () => window.parent.document.getElementById('page').contentWindow;

    const loadScript = (win, src) => new Promise((resolve, reject) => {
        const s = win.document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error(`Failed to load ${src}`));
        win.document.head.append(s);
    });

    window.chrome = {
        tabs: {
            query: async () => [{ id: 1 }],
        },
        action: {
            setBadgeText: async ({ text }) => {
                window.parent.postMessage({ type: 'badge', text }, '*');
            },
        },
        scripting: {
            executeScript: async ({ files, func, args = [] }) => {
                const win = pageWindow();
                if (files) {
                    for (const f of files) await loadScript(win, new URL(f, document.baseURI).href);
                    return [{ result: undefined }];
                }
                // Same isolation semantics as Chrome: the function source runs in the page.
                const result = win.eval(`(${func.toString()})(...${JSON.stringify(args)})`);
                return [{ result: result === undefined ? undefined : structuredClone(result) }];
            },
        },
    };
})();
