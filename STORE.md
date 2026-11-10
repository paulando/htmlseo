# Chrome Web Store listing notes

Use these texts in the Developer Dashboard. Privacy practices → Permission justifications.

## Single purpose

Audits the page in the active tab for SEO: meta tags, headings, images, links, content, structured data and indexability. Results are shown in the extension popup.

## Permission justifications

**activeTab**: Lets the extension analyze the tab the user is looking at when they open the popup.

**scripting**: Injects the page analyzer and the optional on-page highlight overlay into the inspected tab. No remote code is used; all scripts are bundled with the extension.

**storage**: Saves the user's settings (for example the badge on/off option). Also keeps short-lived per-tab data in session storage (the last navigation's HTTP status and redirects, a robots.txt cache, link-check results), which is cleared when the browser closes.

**webRequest**: Observes (never blocks or modifies) the inspected page's main-document request. This reads the HTTP status code, the redirect chain and the X-Robots-Tag header, which are SEO signals the page itself cannot see. Only main-frame requests are observed, and only the status code and a few SEO-related response headers are kept.

**Host permissions (all URLs)**: SEO checks must work on any site the user audits. They are used to:
- show the error badge on each page
- read the navigation signals described above
- fetch that site's robots.txt and sitemap, and check the page's links and hreflang alternates when the user requests it

Requests are sent without cookies.

**Remote code**: No. All code is in the package.

## Data usage

- No personal data is collected, transmitted or sold.
- Analysis runs locally in the browser. Network requests go only to the site being audited (robots.txt, sitemap, links on the page) and only to check SEO signals. External tools in "Quick links" open only when the user clicks them.

Dashboard checkboxes: no data types are collected. Tick that the data is not sold, not used for unrelated purposes, and not used for creditworthiness.
