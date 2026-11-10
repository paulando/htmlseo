# HTML SEO — Chrome extension

A Manifest V3 Chrome extension that inspects the active tab for on-page SEO. It covers meta tags, Open Graph and Twitter tags, headings, images, links and structured data (JSON-LD and microdata), and shows the number of errors as a red toolbar badge. It is plain vanilla JS: **no build step and no dependencies**. The repo folder *is* the extension.

## File map

| File | Runs in | Purpose |
|---|---|---|
| `manifest.json` | — | MV3 manifest. Permissions: `activeTab` and `scripting` only. |
| `analyzer.js` | page (isolated world) | Defines the single global `analyzePage()`, which returns **plain JSON data** (no HTML). Every check lives here. |
| `content.js` | page, on every load | Runs `analyzePage()` and sends `{type:"updateCount", count}` to the background script for the badge. |
| `background.js` | service worker | Sets the per-tab badge text (empty when the count is 0). |
| `popup.html` / `popup.css` / `popup.js` | popup | The UI: an icon rail plus views (Overview, Meta, Headings, Images, Links, Schema). |
| `test/fixture.html` | dev only | A page that triggers every check (broken JSON-LD, skipped heading levels, XSS-ish text…). |
| `test/harness.html` + `test/chrome-stub.js` | dev only | Runs the real popup against a test page in a normal browser tab. |
| `design_inspirations/` | dev only | The visual reference for the UI (see Design system). |

## Data flow

```
popup opens ─► chrome.scripting.executeScript({files:["analyzer.js"]})
            ─► chrome.scripting.executeScript({func: () => analyzePage()}) ─► results[0].result (JSON)
            ─► render*(data) builds DOM with h()      ─► also sets the badge for that tab

page load   ─► analyzer.js + content.js (content_scripts) ─► runtime message ─► background.js badge
```

- The popup always analyzes the page fresh (the ↻ button re-runs it). It never listens to content-script messages, so data from other tabs can't leak into it.
- `analyzer.js` is injected more than once into the same page. **Never add top-level `const`/`let`/`class`**: a second injection would throw "already declared". Keep everything inside `analyzePage()`.
- Scroll-to-element works by injecting `pageScrollTo(selector, index)` (in `popup.js`) with the **nth match index** stored by the analyzer (headings, `img`, `a`). Don't match on text.

## The analyzer result shape

```js
{ url, origin, analyzedAt,
  meta:     { title, titleLength, description, descriptionLength, canonical, canonicalMatches, canonicalCount,
              robots, googlebot, lang, viewport, charset, hreflang[], og[{prop,content}], ogImage, twitter[] },
  headings: [{ tag, level, text, index, hidden, skip }],
  images:   [{ index, src, alt, hasAlt, decorative, width, height, lazy, hidden }],
  links:    [{ index, href, rawHref, text, kind, target, rel, nofollow }],   // kind: internal|external|mailto|tel|anchor|js|empty|other
  schema:   { jsonld[{ index, raw, error, context, entities[{type,id,missing[],data}] }], microdata[{type,id,missing[],data}], entityCount },
  issues:   [{ level: 'error'|'warning'|'info', section: 'meta'|'headings'|'images'|'links'|'schema', message }] }
```

The badge count is the number of `issues` with `level === 'error'`. Use `error` only for things that really hurt indexing or sharing (missing title, missing description or H1, noindex, missing og:image, invalid JSON-LD, duplicate canonical). Everything else is a `warning` or `info`.

## Run and debug

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and select this folder.
2. After editing, click **↻ reload** on the extension card.
   - If you changed `popup.*`, reopening the popup is enough.
   - If you changed `analyzer.js` or `content.js`, **also reload the inspected tab** (old content scripts keep running until then).
   - If you changed `background.js`, reload the extension; the service worker restarts.
3. Debug the popup with right-click on the popup → **Inspect**. Debug the service worker with the "service worker" link on the extension card. Content-script logs appear in the page's DevTools console (choose the extension's context).
4. `file://` pages only work when **Allow access to file URLs** is on. Serving over HTTP is easier.

### Fast UI iteration without reloading the extension

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```
Then open <http://localhost:8765/test/harness.html>. It loads the real `popup.html` with a stubbed `chrome.*` (in `test/chrome-stub.js`) beside `test/fixture.html`, and shows the badge value above the popup. Use `?page=other.html` for another same-origin page (the path is relative to `/test/`). In Claude Code's desktop app, `.claude/launch.json` defines this as the `harness` preview server.

## How to add a check or section

1. **Analyzer**: collect the data in `analyzePage()`, add it to the returned object, and `add(level, section, message)` for each problem.
2. **Popup**: write a `renderX(d)` function in `popup.js`, register it in `RENDERERS`, and add `'x'` to `TABS`.
3. **Rail**: add a `<button class="rail-btn" data-tab="x">` with an inline 24×24 stroke SVG icon and a `<span class="rail-pill" hidden>` to `popup.html`. The pill count fills in automatically from `issues` where `section === 'x'`.
4. **Fixture**: add a case to `test/fixture.html` that triggers the new check, and confirm it in the harness.
5. For a new **schema type** rule, add it to `SCHEMA_RULES` in `analyzer.js`. Use `'a|b'` when at least one of several properties is enough.

## Rules

- **Treat page data as untrusted.** In the popup, build DOM with `h()` (it only sets `textContent` and attributes) and pass URLs through `safeUrl()` or `link()`. **Never `innerHTML` page data.** The analyzer returns data, never markup.
- MV3 CSP: no inline `<script>`, no inline event handlers, no `eval`, and no remote code in extension pages. External links open with `target="_blank" rel="noopener noreferrer"`.
- Keep permissions minimal. Any new permission triggers a re-approval prompt for existing users, so justify it in the PR and in the Web Store listing.
- No frameworks, bundlers or npm dependencies unless that's agreed first.
- The popup is limited by Chrome to **800×600**, and the current size is 720×580 (set in `popup.css` on `html, body`).
- The analyzer runs on **every page load** (for the badge), so keep it fast: no network requests and no layout-heavy loops over all elements.

## Design system

The visual reference is `design_inspirations/`: soft, frosted, light UI.

- **Tokens** are in `:root` at the top of `popup.css`, with a dark variant under `prefers-color-scheme: dark`. Change colours only through the tokens.
  - Background: `--bg` with a radial gradient. Cards: `--card` (translucent white), `--border`, `--shadow`, `--radius: 16px`.
  - Text: `--ink`, `--ink-2`, `--muted`, `--faint`. Accent: `--accent` (blue).
  - Status: `--ok`, `--warn`, `--err`, `--info`, each with a `*-soft` background.
  - Active navigation: `--nav-active` (dark navy tile with white icon).
- **Components** (CSS classes):
  - `.card` with `.card-head` / `.card-title` / `.card-sub`
  - `.tile` (stat tiles in `.grid.grid-3`)
  - `.kv` (key/value rows)
  - `.list` > `.item[.clickable]` with `.item-body` / `.item-title` / `.item-sub` / `.item-chips`
  - `.chip` (variants `ok`, `warn`, `err`, `info`, `accent`, `tag`)
  - `.pills` > `.pill[aria-pressed]` (filters and links)
  - `.btn-sm`, `.icon-btn`, `.meter`, `.serp`, `.tree` (schema), `pre.raw`, `.empty`, `.section-label`
- **Icons** are inline SVG, 24×24 viewBox, with stroke `currentColor` (lucide-style). Don't use icon fonts or remote icons.

## Releasing an upgrade

1. Bump `"version"` in `manifest.json` (currently **3.0**). Use a minor bump for features and a patch bump for fixes. The Web Store rejects a version that isn't higher.
2. Run the manual test checklist below with the unpacked build.
3. Build the zip with **extension files only**:
   ```bash
   zip -r htmlseo-$(grep -o '"version": *"[^"]*"' manifest.json | grep -o '[0-9.]*').zip \
     manifest.json background.js content.js analyzer.js popup.html popup.css popup.js \
     icon.png icon48.png icon64.png icon128.png bg.png LICENSE
   ```
   (Never include `design_inspirations/`, `test/`, `.claude/`, `.git/` or `CLAUDE.md`.)
4. Upload it in the Chrome Web Store Developer Dashboard (Package → Upload new package). If permissions changed, update the listing's privacy and permission justifications too.
5. Tag the commit with `git tag v<version>`.

## Manual test checklist

- [ ] `test/fixture.html` in the harness: every issue appears once, no page markup renders as HTML, and clicking a heading, image or link scrolls to it and highlights it.
- [ ] A rich real page (a news article or product page): the Schema tab lists the entities, the tree expands, and **Copy JSON** and **Raw** work.
- [ ] A clean page shows **no badge**. A page with errors shows the right count, and it updates after navigation.
- [ ] Open the popup, then reload a *different* tab: the popup content does not change.
- [ ] On `chrome://extensions` or the Web Store, the popup shows "This page can't be analyzed".
- [ ] Light and dark OS themes both look right.
- [ ] A page with thousands of links or images: the lists cap at 500 rows and the popup stays responsive.

## Backlog (ideas, not built)

- An `X-Robots-Tag` header check (needs `webRequest` or a background `fetch` of the URL).
- `robots.txt` and sitemap presence checks, and an on-demand broken-link check (HEAD requests from the background).
- Word count, text/HTML ratio, a favicon check, and a duplicate title = H1 warning.
- RDFa support in the Schema tab, plus deeper validation (required vs recommended per Google's rich-result docs).
- Export the report as JSON or Markdown, and copy individual sections.
- Re-run automatically on SPA route changes (the popup currently has a manual ↻ button).
- Highlight all images without alt on the page at once (an overlay toggle).
