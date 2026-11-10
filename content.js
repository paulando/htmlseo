/*
 * content.js — runs automatically on every page (manifest "content_scripts"),
 * after analyzer.js.
 *  - Keeps the toolbar badge in sync with the page's error count (when the
 *    "autoBadge" setting is on — default).
 *  - SPA support: re-analyzes after client-side route changes and tells an open
 *    popup ({type:"pageChanged"}) so it can refresh.
 */
(() => {
    // Ignore plain #anchor jumps; keep hash routes like #/page or #!/page.
    const routeKey = () => (/^#[!/]/.test(location.hash) ? location.href : location.href.split('#')[0]);

    let autoBadge = true;
    let lastUrl = routeKey();
    let timer = 0;

    const send = (message) => {
        try {
            chrome.runtime.sendMessage(message)?.catch?.(() => {});
        } catch {
            // Extension was reloaded/removed; this orphaned script can't talk anymore.
        }
    };

    const run = () => {
        if (!autoBadge) return;
        try {
            const count = analyzePage().issues.filter((i) => i.level === 'error').length;
            send({ type: 'updateCount', count, url: location.href });
        } catch {
            // Never break the host page.
        }
    };

    const onMaybeNavigated = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            if (routeKey() === lastUrl) return;
            lastUrl = routeKey();
            run();
            send({ type: 'pageChanged', url: location.href });
        }, 800);
    };

    chrome.storage.sync.get({ autoBadge: true })
        .then((s) => { autoBadge = s.autoBadge; })
        .catch(() => {})
        .finally(run);

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes.autoBadge) autoBadge = changes.autoBadge.newValue !== false;
    });

    // Navigation API where available, plus fallbacks for history-based routers.
    window.navigation?.addEventListener?.('navigatesuccess', onMaybeNavigated);
    window.addEventListener('popstate', onMaybeNavigated);
    window.addEventListener('hashchange', onMaybeNavigated);
    setInterval(() => { if (routeKey() !== lastUrl) onMaybeNavigated(); }, 1000);
})();
