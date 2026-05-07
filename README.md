# Site Shield

Site Shield is a local-only Chrome Manifest V3 extension scoped to `example.com` and `*.example.com`. It is a domain-specific shield, not a general ad blocker.

## Architecture

- `manifest.json` scopes host access and content scripts to the target domain only.
- `rules/static_rules.json` blocks known bad third-party ad, popup, and redirect hosts through `declarativeNetRequest`.
- `src/background/service_worker.js` owns settings, dynamic DNR rules, session counters, and selective cookie cleanup.
- `src/content/content.js` removes suspicious overlays/iframes, intercepts click traps, and selectively scrubs suspicious storage keys.
- `src/content/page_guard.js` runs in the page context to neutralize obvious `window.open` abuse.
- `src/popup/*` provides the extension UI for status, toggles, custom blocked hosts/selectors, debug mode, and manual cookie scrubbing.
- `src/shared/*` contains target-domain constants and tuneable heuristics.

No remote code, remote rule downloads, analytics, or telemetry are used.

## Load Unpacked

1. Open Chrome on desktop.
2. Go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this repository folder.
6. Visit `https://example.com` or a subdomain to test activation.

## How To Test

- Open `chrome://extensions` and confirm Site Shield loads without manifest errors.
- Visit a non-target site and confirm the popup says the extension is inactive on that site.
- Visit `https://example.com` and confirm the popup reports the current target host.
- Toggle the shield off, reload the target tab, and confirm DOM cleanup no longer runs.
- Toggle debug logging on, reload the target tab, and inspect the page console/service worker console for `[Site Shield]` messages.
- Add a custom blocked host in the popup, save, reload the target tab, and verify requests to that host are blocked.
- Add a custom selector such as `.annoying-overlay`, save, reload, and verify matching target-site elements are hidden.
- Create test storage keys such as `popup_seen` or `redirect_campaign` in DevTools and reload; they should be removed.
- Create normal keys and cookies that do not match suspicious patterns; they should remain.

## Tuning Notes

- Add/remove known network hosts in `rules/static_rules.json` for static blocking.
- Add one host per line in the popup for local dynamic DNR rules.
- Add one CSS selector per line in the popup for site-specific DOM cleanup.
- Tune suspicious storage/cookie terms in `src/shared/config.js`.
- Protected cookie terms in `src/shared/config.js` prevent broad deletion of auth/session-like cookies.

## Known Limitations

- Static and dynamic request counts rely on `declarativeNetRequest.onRuleMatchedDebug`, which is mainly useful for unpacked/debug builds.
- The enable/disable toggle is global for the target site scope, not per individual subdomain.
- The page-level `window.open` guard uses built-in known host patterns; custom popup hosts are handled by DNR and content-click checks, not the injected page script.
- DOM heuristics are conservative by design and may need target-site tuning after observing real bad elements.
- Chrome extensions cannot stop every navigation method used by hostile page scripts, but this blocks common click, iframe, redirect URL, DNR, and `window.open` paths.
