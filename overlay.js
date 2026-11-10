/*
 * overlay.js — injected into the inspected page on demand by the popup.
 * Draws outlines + labels over elements (headings, images without alt, nofollow
 * links, internal/external links) inside a closed shadow root so page CSS can't
 * interfere and our CSS can't leak.
 *
 * Exposes ONE global: window.__htmlseoOverlay = { toggle(mode, on), modes() }.
 * May be injected repeatedly: no top-level const/let/class (ESLint enforces this).
 */
if (!window.__htmlseoOverlay) {
    window.__htmlseoOverlay = (() => {
        const MAX_PER_MODE = 2000;
        const active = new Set();
        let host = null;
        let layer = null;
        let raf = 0;

        const COLORS = { H1: '#0f172a', H2: '#2563eb', H3: '#7c3aed', H4: '#0891b2', H5: '#64748b', H6: '#94a3b8' };

        const collect = {
            headings: () => [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
                .map((el) => ({ el, label: el.tagName, color: COLORS[el.tagName] })),
            alt: () => [...document.querySelectorAll('img')]
                .filter((el) => !el.hasAttribute('alt') || el.getAttribute('alt').trim() === '')
                .map((el) => (el.hasAttribute('alt')
                    ? { el, label: 'decorative', color: '#94a3b8' }
                    : { el, label: 'no alt', color: '#ef4444' })),
            nofollow: () => [...document.querySelectorAll('a[rel]')]
                .filter((el) => /\b(nofollow|ugc|sponsored)\b/i.test(el.getAttribute('rel')))
                .map((el) => ({ el, label: el.getAttribute('rel').toLowerCase(), color: '#f59e0b' })),
            links: () => [...document.querySelectorAll('a[href]')]
                .filter((el) => /^https?:$/.test(el.protocol))
                .map((el) => {
                    const external = el.host.replace(/^www\./, '') !== location.host.replace(/^www\./, '');
                    return { el, label: external ? 'ext' : '', color: external ? '#a855f7' : '#3b82f6' };
                }),
        };

        function ensureHost() {
            if (host) return;
            host = document.createElement('htmlseo-overlay');
            host.style.cssText = 'all:initial;position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
            const root = host.attachShadow({ mode: 'closed' });
            const style = document.createElement('style');
            style.textContent = `
                .box { position: absolute; box-sizing: border-box; border: 2px solid var(--c); border-radius: 3px; background: color-mix(in srgb, var(--c) 8%, transparent); }
                .label { position: absolute; left: -2px; top: -18px; font: 600 11px/16px system-ui, sans-serif; padding: 0 5px; border-radius: 3px;
                         background: var(--c); color: #fff; white-space: nowrap; max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
                .label.inside { top: 0; left: 0; border-radius: 0 0 3px 0; }
            `;
            layer = document.createElement('div');
            root.append(style, layer);
            document.documentElement.append(host);
            window.addEventListener('scroll', schedule, { passive: true, capture: true });
            window.addEventListener('resize', schedule, { passive: true });
        }

        function teardown() {
            window.removeEventListener('scroll', schedule, { capture: true });
            window.removeEventListener('resize', schedule);
            cancelAnimationFrame(raf);
            host?.remove();
            host = null;
            layer = null;
        }

        function schedule() {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(draw);
        }

        function draw() {
            if (!layer) return;
            const frag = document.createDocumentFragment();
            const sx = window.scrollX;
            const sy = window.scrollY;
            const isVisible = makeVisibilityCheck();
            let count = 0;
            active.forEach((mode) => {
                collect[mode]().slice(0, MAX_PER_MODE).forEach(({ el, label, color }) => {
                    const r = el.getBoundingClientRect();
                    if (r.width < 1 || r.height < 1 || !isVisible(el, r)) return;
                    count++;
                    const box = document.createElement('div');
                    box.className = 'box';
                    box.style.cssText = `--c:${color};left:${r.left + sx}px;top:${r.top + sy}px;width:${r.width}px;height:${r.height}px;`;
                    if (label) {
                        const tag = document.createElement('span');
                        tag.className = r.top + sy < 18 ? 'label inside' : 'label';
                        tag.textContent = label;
                        box.append(tag);
                    }
                    frag.append(box);
                });
            });
            layer.replaceChildren(frag);
            host.dataset.count = String(count); // test hook: number of boxes drawn
        }

        /*
         * Compact copy of the visibility logic in analyzer.js (isHidden/clippedByAncestor):
         * checkVisibility + not clipped by an ancestor's overflow. Keep them in sync.
         * Styles are cached per draw() call.
         */
        function makeVisibilityCheck() {
            const styles = new Map();
            const styleOf = (el) => {
                let cs = styles.get(el);
                if (!cs) { cs = getComputedStyle(el); styles.set(el, cs); }
                return cs;
            };
            const paint = (cs) => /paint|strict|content/.test(cs.contain);
            const formsCB = (cs) => cs.transform !== 'none' || cs.filter !== 'none' || /paint|layout|strict|content/.test(cs.contain);
            return (el, rect) => {
                if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
                let { top, left, bottom, right } = rect;
                let pos = styleOf(el).position;
                for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
                    const cs = styleOf(p);
                    if (pos === 'fixed' && !formsCB(cs)) continue;
                    if (pos === 'absolute' && cs.position === 'static' && !formsCB(cs)) continue;
                    const clipX = cs.overflowX !== 'visible' || paint(cs);
                    const clipY = cs.overflowY !== 'visible' || paint(cs);
                    if (clipX || clipY) {
                        const r = p.getBoundingClientRect();
                        // Overlay only draws boxes with real size, so an empty intersection = clipped.
                        if (clipX) { left = Math.max(left, r.left); right = Math.min(right, r.right); if (r.width < 1 || right <= left) return false; }
                        if (clipY) { top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom); if (r.height < 1 || bottom <= top) return false; }
                    }
                    pos = cs.position;
                }
                return true;
            };
        }

        return {
            toggle(mode, on) {
                if (!collect[mode]) return [...active];
                if (on) active.add(mode); else active.delete(mode);
                if (!active.size) teardown();
                else { ensureHost(); draw(); }
                return [...active];
            },
            modes() {
                return [...active];
            },
        };
    })();
}
