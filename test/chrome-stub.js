/*
 * DEV ONLY — fakes the chrome.* APIs the popup uses, so popup.html can run in a
 * normal browser tab next to a test page. Loaded by test/harness.html, never shipped.
 * The "active tab" is the #page iframe in the harness (must be same-origin).
 * storage.* is in-memory (fresh on every harness load).
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

    const changeListeners = [];
    const makeArea = (name) => {
        const data = {};
        return {
            async get(keys) {
                if (keys == null) return { ...data };
                if (typeof keys === 'string') return keys in data ? { [keys]: data[keys] } : {};
                if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]));
                return Object.fromEntries(Object.entries(keys).map(([k, def]) => [k, k in data ? data[k] : def]));
            },
            async set(items) {
                const changes = {};
                Object.entries(items).forEach(([k, v]) => { changes[k] = { oldValue: data[k], newValue: v }; data[k] = structuredClone(v); });
                changeListeners.forEach((fn) => fn(changes, name));
            },
            async remove(keys) { [].concat(keys).forEach((k) => delete data[k]); },
        };
    };

    const messageListeners = [];
    // Lets the harness simulate content.js messages, e.g. a SPA route change.
    window.__simulateMessage = (msg) => messageListeners.forEach((fn) => fn(msg, { tab: { id: 1 } }));

    window.chrome = {
        tabs: { query: async () => [{ id: 1 }] },
        windows: { create: async ({ url }) => { window.open(url, '_blank'); } },
        action: { setBadgeText: async () => {} },
        runtime: {
            getManifest: () => ({ version: 'dev' }),
            getURL: (p) => new URL(p, document.baseURI).href,
            sendMessage: async (msg) => {
                if (msg?.type === 'popupCount') window.parent.postMessage({ type: 'badge', text: msg.count ? String(msg.count) : '' }, '*');
            },
            onMessage: { addListener: (fn) => messageListeners.push(fn) },
        },
        storage: {
            sync: makeArea('sync'),
            session: makeArea('session'),
            onChanged: { addListener: (fn) => changeListeners.push(fn) },
        },
        scripting: {
            executeScript: async ({ files, func, args = [] }) => {
                const win = pageWindow();
                if (files) {
                    for (const f of files) await loadScript(win, new URL(f, document.baseURI).href);
                    return [{ result: undefined }];
                }
                // Same semantics as Chrome: the function's source runs in the page.
                const result = win.eval(`(${func.toString()})(...${JSON.stringify(args)})`);
                const value = result instanceof win.Promise ? await result : result;
                return [{ result: value === undefined ? undefined : structuredClone(value) }];
            },
        },
    };
})();
