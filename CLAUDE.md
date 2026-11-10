# HTML SEO — Chrome extension

A Manifest V3 Chrome extension that audits the active tab for on-page SEO and indexability. It covers:
- meta tags and social previews
- content stats
- headings, images (including performance) and links (including a broken-link check)
- structured data
- HTTP status, redirects and X-Robots-Tag
- robots.txt and sitemap

The extension itself is **plain vanilla JS with no build step and no runtime dependencies**. npm is used only for **dev tooling** (Playwright, ESLint); nothing from `node_modules` ships.

## File map

| Path | Runs in | Purpose |
|---|---|---|
| `manifest.json` | — | MV3 manifest (see Permissions). |
| `analyzer.js` | page (isolated world) | The single global `analyzePage()`. It returns **plain JSON** (no HTML), and all on-page checks live here. |
| `content.js` | page, every load | Runs the analyzer and sends `updateCount` for the badge (when the `autoBadge` setting is on). On SPA route changes it re-runs and sends `pageChanged`. |
| `overlay.js` | page, on demand | The on-page overlay (closed shadow root). It defines one global, `window.__htmlseoOverlay`. |
| `background.js` | service worker | Captures navigations with webRequest (redirect chain, status, headers) into `storage.session`, and owns the badge. |
| `popup.html` / `popup.css` | popup | Shell (icon rail and topbar) and the design system. |
| `popup/main.js` | popup | Entry module: boot, `analyze()`, server checks, export menu, render loop. |
| `popup/state.js` | popup | `state`, settings (`chrome.storage.sync`), `go()` / `rerender()`, `allIssues()` (analyzer issues plus popup-side `serverIssues()`). |
| `popup/dom.js` | popup | Safe DOM helpers: `h()`, `link()`, `safeUrl()`, `chip()`, `card()`, `kv()`, `truncateToPx()`, … |
| `popup/page.js` | popup | `chrome.scripting` wrappers: `runAnalyzer`, `scrollInPage`, `setOverlay`. |
| `popup/net.js` | popup | Network checks: server info (with re-fetch fallback), robots.txt parser and verdict, sitemap, link checker, hreflang return links. |
| `popup/report.js` | popup | Export as Markdown or JSON, and download. |
| `popup/views/*.js` | popup | One renderer per tab: overview, meta, content, headings, images, links, schema, indexing, settings. |
| `scripts/build.mjs` | node | `npm run build` stages the shipped files to `dist/unpacked` and zips them. The **`SHIPPED` list** is the source of truth. |
| `test/server.mjs` | node | Zero-dependency test server: static files plus `/robots.txt`, `/sitemap.xml`, `/redirect-301`, `/xrobots-noindex`, `/status/<code>`, `/img/<w>x<h>.png`. |
| `test/fixtures/*.html` | dev | Pages that trigger the checks (`fixture` = everything wrong, `clean` = no errors, `images`, `hreflang-*`, `spa`, `blocked`). |
| `test/*.spec.js` | dev | Playwright: `analyzer.spec.js` (plain Chromium) and `extension.spec.js` (loads the staged extension). |
| `test/harness.html` + `chrome-stub.js` | dev | Runs the real popup next to a fixture in a normal tab, with a stubbed `chrome.*`. |
| `design_inspirations/` | dev | The visual reference for the UI. |

## Data flow

```
page load   ─► webRequest (background.js) ─► storage.session "tab:<id>".nav {chain, status, headers}
            ─► analyzer.js + content.js   ─► {type:"updateCount"} ─► background: badge = page + server errors

popup open  ─► executeScript(analyzer.js) + func: analyzePage() ─► state.data ─► render
            ─► net.js: getServerInfo (nav from storage.session, else re-fetch), getRobots, getSitemap
            ─► {type:"popupCount", tabId, count} ─► background: badge override = popup's full count
            ─► on demand: link check, hreflang return links, overlay toggles, export

SPA route   ─► content.js (Navigation API / popstate / URL poll) ─► updateCount + {type:"pageChanged"}
            ─► open popup for that tab re-analyzes (setting "spaReanalyze")
```

- **Issue sections**: `meta`, `content`, `headings`, `images`, `links` and `schema` come from the analyzer; `indexing` comes from the popup (`serverIssues()` in `state.js`). Rail pills count errors (red), otherwise warnings (amber), per section.
- **Badge**: `override ?? (autoBadge ? page + serverErrors : 0)`. A new navigation resets the override, and an SPA `updateCount` replaces it.
- The first navigation right after the browser starts can arrive before the worker's webRequest listeners are live. The popup then re-fetches the page and labels the response "re-fetched".

## Permissions (and why)

| Permission | Why |
|---|---|
| `activeTab`, `scripting` | Run `analyzer.js` and `overlay.js` in the inspected tab. |
| `storage` | Settings (`sync`), plus per-tab navigation data, the robots.txt cache and link-check results (`session`). |
| `webRequest` (observe only, no blocking) | Read the main-frame redirect chain, status and `X-Robots-Tag`, which the page itself can't see. |
| `host_permissions: <all_urls>` | Content script for the badge, webRequest on any site, and cross-origin `fetch` from the popup (robots.txt, sitemap, link and hreflang checks). |

Any new permission prompts existing users to re-approve. Justify it in the PR and in `STORE.md`.

## Run and debug

```bash
npm install                      # dev tooling only
npx playwright install chromium  # once, for tests
npm run serve                    # test server on http://localhost:8765 (opens the harness at /)
```

- **Fast UI work**: open <http://localhost:8765/test/harness.html?page=fixture.html> (the page picker is at the top). It runs the real popup with in-memory storage. Server data comes from the re-fetch fallback, and **cross-origin link checks fail with CORS there** (they work in the real extension).
- **Real extension**: run `npm run build`, then go to `chrome://extensions` → Developer mode → **Load unpacked**, and choose `dist/unpacked` (or the repo root). After edits, click ↻ on the extension card. Also reload the inspected tab when `analyzer.js` or `content.js` changed.
- Inspect the popup by right-clicking it → Inspect, or use the ⧉ pop-out button, which opens `popup.html?tabId=N` in a window that stays open. Inspect the worker from the "service worker" link on the extension card.

## Tests and lint

```bash
npm run lint          # ESLint 10 flat config (eslint.config.js)
npm test              # Playwright: analyzer + extension e2e (starts test/server.mjs itself)
npm run test:headed   # watch it
```

- `analyzer.spec.js` injects `analyzer.js` into fixture pages and asserts on `analyzePage()`.
- `extension.spec.js` loads the **staged** extension (`stage()` from `scripts/build.mjs`) with `channel: 'chromium'`.
  - The popup is opened as a tab (`popup.html?tabId=`).
  - The badge is read with `chrome.action.getBadgeText`.
  - A warm-up navigation makes webRequest capture deterministic.
- CI runs lint and the tests on every push and PR (`.github/workflows/test.yml`).

## How to add a check or feature

1. **Page data**: add it to `analyzePage()` and `add(level, section, message)` for each problem. **No top-level `const`/`let`/`class` in `analyzer.js` or `overlay.js`** (they are re-injected); ESLint enforces this.
2. **Network data**: add a function to `popup/net.js`, call it from `runServerChecks()` in `main.js`, store the result on `state`, and turn problems into issues in `serverIssues()`.
3. **UI**: render in the relevant `popup/views/*.js`. For a new tab, add it to `TABS` (`state.js`), `RENDERERS` (`main.js`) and a rail button in `popup.html`.
4. **Fixture and test**: add a case to `test/fixtures/` (or a route in `test/server.mjs`) and a test to the matching spec.
5. **Runtime file added?** Add it to `SHIPPED` in `scripts/build.mjs`, or it won't ship and the e2e tests will fail.
6. **Schema type rules** live in `SCHEMA_RULES` in `analyzer.js` (`'a|b'` means at least one of them).

## Rules

- **Page data is untrusted.** Build popup DOM only with `h()` (it sets `textContent`/attributes) and `link()`/`safeUrl()` for URLs. **Never `innerHTML`.** Fetched HTML is parsed only with `DOMParser` (inert).
- Network requests from the popup use `credentials: 'omit'` (we want what a crawler sees) and have timeouts. They happen only when the popup is open, or when the user presses a check button.
- MV3 CSP: no inline scripts or handlers, no `eval`, no remote code. Popup modules are loaded with `<script type="module">`.
- Popup max size is 800×600 (currently 720×580). `html.detached` makes it fluid in the pop-out window.
- The analyzer runs on every page load (when `autoBadge` is on), so keep it fast: no network, and no per-element layout reads in large loops beyond what is there.
- **"Visible" means** `checkVisibility()` **and** not clipped away by an ancestor's `overflow`/`contain: paint` (respecting containing blocks for absolute and fixed elements) **and** not horizontally off-screen. This is what keeps images in collapsed hover menus (`max-height:0; overflow:hidden`), off-canvas drawers and carousel slides out of the "above the fold" checks.
  - The logic is `isHidden`/`clippedByAncestor` in `analyzer.js`. `overlay.js` has a compact copy, so change both together.
  - Fixture cases live in `test/fixtures/images.html` (`data-hidden-case`).
- Keep the generic "Facebook-style / X-style / LinkedIn-style" social mock-ups unbranded: no logos and no platform styling.

## Design system

The visual reference is `design_inspirations/`: soft, frosted, light UI with a dark-navy active tile.

- **Tokens** are in `:root` at the top of `popup.css`, with a dark variant under `prefers-color-scheme: dark`. Change colours only through the tokens.
  - `--bg`, `--card`, `--border`, `--shadow`, `--radius`
  - `--ink`, `--muted`, `--faint`
  - `--accent`
  - `--ok`, `--warn`, `--err`, `--info`, each with a `*-soft` variant
  - `--nav-active`
- **Components** (CSS classes):
  - layout: `.card`/`.card-head`, `.tile` (`.static`), `.kv`, `.list` > `.item[.clickable]`
  - controls: `.chip` (ok, warn, err, info, accent, tag), `.pills` > `.pill[aria-pressed]` (`.toggle`), `.btn-sm`, `.icon-btn`, `.menu`, `.switch`, `.num-input`
  - feedback: `.meter`, `.toast`, `.banner`, `.empty`, `.section-label`
  - tab-specific: `.serp`, `.social-card` (`.large`, `.side`, `.compact`), `.tree`/`.ref-btn` (schema), `.verdict`/`.steps` (indexing)
- **Icons** are inline 24×24 stroke SVGs (lucide-style), using `currentColor`.

## Releasing an upgrade

1. Bump `"version"` in `manifest.json` (currently **4.0**). Use a minor bump for features and a patch bump for fixes.
2. Run `npm run lint && npm test`, then go through the manual checklist below in real Chrome.
3. Run `npm run build` to produce `dist/htmlseo-<version>.zip`, containing only the `SHIPPED` files.
4. Upload it in the Chrome Web Store dashboard. If permissions changed, update the justifications from `STORE.md`.
5. Tag the commit: `git tag v<version>`.

## Manual checklist (real Chrome, things CI can't see)

- [ ] A news article: schema references jump between cards, social previews show the og:image, and image performance has findings.
- [ ] An `http://` URL that redirects to `https://`: the chain shows in Indexing as "from page load".
- [ ] A large SPA (for example a docs site): navigating re-analyzes the open popup.
- [ ] Settings → turn off the auto badge: badges clear and stay empty on new pages.
- [ ] A page with hundreds of links: the link check progresses, Stop works, and the Broken filter is right.
- [ ] Light and dark OS themes, the popup and the pop-out window.

## Backlog (not built)

- RDFa in the Schema tab, and Google's required-vs-recommended properties per rich-result type.
- A canonical target check (status and indexability of the canonical URL).
- Gzipped sitemaps, and following sitemap indexes into their child sitemaps.
- Per-page history ("what changed since last visit").
- Localised stopword lists for the content stats.
