# Site Shield

Site Shield is a local-only Chrome Manifest V3 extension for selected desktop Chrome sites. It is not a generic ad blocker. Core logic is profile-driven so each supported site can define its own scope, network hosts, DOM selectors, storage/cookie heuristics, and page-world guard behavior.

No remote code, remote rule downloads, analytics, or telemetry are used.

## Architecture

- `manifest.json` declares MV3 permissions, required Mangakakalot host access, broad optional host access for future profiles, static DNR rules, and popup.
- `src/profiles/schema.js` defines the profile shape and normalizers.
- `src/profiles/sites/*.js` contains site-specific profile definitions.
- `src/profiles/index.js` builds the profile registry and answers "which profile matches this host?"
- `rules/static_rules.json` contains static `declarativeNetRequest` rules for known bad hosts in current profiles.
- `src/background/service_worker.js` owns profile activation, permission checks, dynamic content-script registration, dynamic DNR reconciliation, selective cookie cleanup, session counters, and bounded debug events.
- `src/content/content.js` receives the matched profile and performs DOM cleanup, iframe removal, click interception, and selective storage scrubbing.
- `src/content/page_guard.js` is dynamically registered with `world: "MAIN"` at `document_start` so page-global patches such as `window.open` run in the page world, not the content script isolated world.
- `src/popup/*` shows current matched profile, in-scope status, counters, profile-scoped custom hosts/selectors, debug mode, and recent events.

## Profile Structure

Profiles live in `src/profiles/sites/` and are registered by pushing definitions into `SiteShieldProfileDefinitions`. `src/profiles/index.js` validates and exposes them.

Each profile can define:

- `id`
- `displayName`
- `description`
- `matchPatterns`
- `hostPermissionPatterns`
- `domains`
- `includeSubdomains`
- `dnrInitiatorDomains`
- `staticRuleIds`
- `staticBlockedHosts`
- `dynamicBlockedHosts`
- `suspiciousDomSelectors`
- `suspiciousTextTerms`
- `suspiciousStorageKeyTerms`
- `suspiciousCookieKeyTerms`
- `protectedCookieTerms`
- `pageGuard`
- `tuning`

The first profile is `mangakakalot` in `src/profiles/sites/mangakakalot.js`. It covers:

- `https://mangakakalot.gg/*`
- `https://www.mangakakalot.gg/*`

The initial Mangakakalot tuning is intentionally conservative. The priority is the reusable profile architecture; site-specific blocking should be tightened after observing real requests and DOM patterns.

Mangakakalot also defines page types:

- `home`: `/`
- `manga`: `/manga/<slug>`
- `chapter`: `/manga/<slug>/chapter-<id>`

Chapter pages are treated more strictly because the reader view is where confirmed junk links appear. The sample reference shape is:

```text
https://www.mangakakalot.gg/manga/my-neighbor-ms-kurokawa/chapter-43
```

## Observe Vs Block

Mangakakalot rules are split so tuning can be evidence-driven:

- `hardBlockHosts`: hosts that are blocked by static or dynamic DNR rules.
- `candidateBlockHosts`: hosts that are logged in inspection mode but not blocked automatically.
- `hardDomSelectors`: selectors that remove matching suspicious elements.
- `candidateDomSelectors`: selectors that are logged in inspection mode but not removed.
- `suspiciousStorageKeyTerms`: storage keys that are removed.
- `candidateStorageKeyTerms`: storage keys that are logged but kept.
- `suspiciousCookieKeyTerms`: cookie names that are removed unless protected.
- `candidateCookieKeyTerms`: cookie names that are logged but kept.
- `protectedCookieTerms`: auth/session-like cookie names that are not removed.

Custom blocked hosts and custom selectors entered in the popup are treated as blocking rules for the matched profile.

## Mangakakalot Chapter Rules

Confirmed chapter-page junk promoted to hard block:

- `seonetwork.net`
- `abcya3.games`
- `flax.to`
- `coolgamesunblocked.com`
- `crazygamesunblocked.net`
- `sunwin28.bz`
- `hi88s.com`

Confirmed wildcard-style junk handled by URL/text keyword rules and static DNR regex:

- `open88.*`
- `fun88.*`

These are intentionally not applied to manga image hosts. Chapter cleanup focuses on anchors and small surrounding text containers whose href/text matches those domains or keywords, while avoiding images, chapter navigation, image server controls, forms, comments, and first-party chapter links.

Chapter pages also get click-trap overlay neutralization. The content script checks bounded changed roots for clickable elements that are fixed/absolute/sticky, large enough to cover the viewport or reader area, near-transparent or empty, or off-site. Clear junk anchors are hidden; riskier page-covering surfaces have pointer events disabled and inline click handlers removed. Diagnostics include `pageType`, `reason`, tag/node summary, host, trigger, and approximate rect.

Stateful click hijacks are handled separately from overlay removal. On chapter pages, a MAIN-world capture listener shields `pointerdown`, `mousedown`, `click`, and `auxclick` before late page handlers can consume them. It blocks off-site/junk action targets, plain delegated clicks on the chapter page, and any off-site `window.open`/location navigation attempted during the guarded click window. First-party chapter links are handled as safe navigations: the original page click is stopped, then the guard navigates to the first-party URL itself. Diagnostics report `clickCount`, `clickSerial`, action source (`window_open`, `anchor_blank`, `anchor_click`, `location_assign`, `location_replace`, `location_href`, `handler`, or `unknown`), duplicate open attempts, and whether the event happened shortly after a DOM mutation burst.

Narrow Mangakakalot reader allowlist:

- chapter navigation controls
- image/server switching controls
- chapter info panels
- comments/login/report-style form controls

Manga images remain protected from DOM removal, but ordinary clicks on the reader image area are not treated as legitimate controls. That split is intentional: it preserves image loading while preventing delegated page listeners from using a plain reader click to open a scam tab.

Chapter orphan cleanup also removes bounded leftover ad UI such as isolated close buttons, `advertisement` labels, and empty ad-named wrappers after the main junk block has been hidden.

Footer/bottom junk is handled by targeted chapter anchor scans for confirmed junk domains and keywords before the generic bounded anchor scan runs. This helps remove late-page spam groups such as `sunwin28.bz`, OPEN88/Fun88 variants, and `hi88s.com` without repeatedly scanning the full document.

The chapter profile has a dedicated popup-layer remover for `content notification` / `CANCEL` style blockers. It looks for notification/dialog nodes, climbs only a few ancestors to find the small popup container, hides it, and then neutralizes likely fixed-position backdrops around it. A throttled scroll/timer check repeats this narrow popup scan so mutation-, scroll-, or timer-triggered reinsertions are removed again without rerunning the full DOM cleanup.

## Runtime Model

- Known profile: a profile module exists in `src/profiles/sites/` and is present in the registry.
- Activated profile: the profile id is stored in `chrome.storage.local` under the extension settings and participates in script/rule reconciliation.
- Granted host access: Chrome has granted the profile's `hostPermissionPatterns`, either because they are required host permissions or because the user granted optional host permission at runtime.

A profile only runs when all three are true: it is known, activated, and has granted host access. The global shield and per-profile enable toggles can still disable behavior without removing activation.

On startup and setting changes, the service worker reconciles:

- dynamic isolated-world content script registration for activated profiles,
- dynamic MAIN-world page-guard registration for activated profiles that enable it,
- static DNR rule IDs owned by activated profiles,
- deterministic dynamic DNR rules from profile defaults plus custom blocked hosts.

## Adding A New Site Later

1. Create `src/profiles/sites/new-site.js`.
2. Push a profile definition into `SiteShieldProfileDefinitions`.
3. Add the script path to `PROFILE_RUNTIME_FILES` in `src/shared/config.js` and the service worker `importScripts` list.
4. Use the popup or background helper to request the profile's host permission.
5. Activate the profile, then let startup/settings reconciliation register scripts and dynamic rules.
6. Add static DNR rules in `rules/static_rules.json` only when a host is well understood and stable.
7. Load the extension unpacked and smoke test the new profile.

The manifest includes broad `optional_host_permissions` so future sites do not need a manifest host permission edit. Chrome still requires profile modules to be bundled locally, so new profile code must be added to the extension package.

## Permissions

- `alarms`: schedules periodic selective cookie cleanup.
- `cookies`: removes only profile-matched suspicious cookie names.
- `declarativeNetRequest`: applies static and dynamic network blocking rules.
- `declarativeNetRequestFeedback`: records local debug counts/events for matched DNR rules while testing unpacked.
- `scripting`: dynamically registers profile-scoped content scripts and the MAIN-world page guard.
- `storage`: saves settings, counters, and bounded local debug events.
- `activeTab`: lets the popup identify the current tab hostname after the user opens it.
- `host_permissions`: currently limited to `mangakakalot.gg` and `www.mangakakalot.gg` so profile #1 works immediately.
- `optional_host_permissions`: `*://*/*` lets future local profiles request exact site origins at runtime without a manifest edit.

## Load Unpacked

1. Open Chrome on desktop.
2. Go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this repository folder.
6. Visit `https://mangakakalot.gg` or `https://www.mangakakalot.gg` to test activation.

## Smoke Test

- Open `chrome://extensions` and confirm Site Shield loads without manifest errors.
- Visit a non-profile site and confirm the popup reports out-of-scope.
- Visit `https://mangakakalot.gg` or `https://www.mangakakalot.gg` and confirm the popup shows `Mangakakalot` and profile id `mangakakalot`.
- Confirm the known profiles section shows Mangakakalot as activated with permission granted.
- Deactivate Mangakakalot from the known profiles section, reload the tab, and confirm registered scripts/rules stop applying.
- Activate Mangakakalot again, reload the tab, and confirm profile behavior resumes.
- Toggle the global shield off, reload the matched tab, and confirm DOM cleanup no longer runs.
- Toggle the matched profile off, reload the matched tab, and confirm profile-specific behavior stops.
- Toggle debug logging on, reload the matched tab, and inspect the page console/service worker console for `[Site Shield]` messages.
- Add a custom blocked host in the popup, save, reload the matched tab, and verify requests to that host are blocked.
- Add a custom selector such as `.annoying-overlay`, save, reload, and verify matching profile-site elements are hidden.
- Create test storage keys such as `popup_seen` or `redirect_campaign` in DevTools and reload; they should be removed.
- Create normal keys and cookies that do not match suspicious profile patterns; they should remain.
- Use **Scrub cookies** in the popup and confirm only suspicious cookie names are removed.

## Observability

When debug logging is enabled, the background stores a bounded local event list in `chrome.storage.local`. Inspection mode turns debug logging on and also records observe-only candidate matches. Events include `profileId`, page URL/host, an action such as `block` or `observe`, and categories such as:

- `network`
- `dom`
- `storage`
- `cookie`
- `click`
- `open`
- `permission`
- `profile`
- `manual`

The popup shows the newest events for the matched profile and includes a **Copy debug** button. The copied diagnostic JSON contains extension version, active profile id, granted permissions summary, activated profiles, registered content scripts, counters, recent events, profile settings, and the Mangakakalot tuning summary.

Debug has three practical safety levels:

- Off: no debug events are recorded.
- Basic debug: records important blocked actions only.
- Inspection: records observe-only candidate matches, but DOM work is throttled and events are buffered, coalesced, rate-limited, trimmed, and capped.

The popup perf line reports DOM passes, skipped passes, shielded clicks, blocked opens, orphan UI removed, footer groups removed, popup layers removed, rearmed attempts blocked, dropped events, coalesced events, and storage flushes. If these climb quickly while browsing, turn inspection mode off and promote only rules that already have repeated evidence.

## Mangakakalot Tuning Workflow

1. Load the extension unpacked and open `https://mangakakalot.gg` or `https://www.mangakakalot.gg`.
2. Open the popup and enable **Debug logging and recent events**.
3. Enable **Inspection mode: log observe-only matches**.
4. Browse normally, including actions that previously triggered popups or redirects.
5. Watch **Recent events** for:
   - `network observe`: candidate hosts seen in URLs, iframes, or opens.
   - `dom observe`: candidate selectors or overlay-shaped nodes seen but not removed.
   - `storage observe`: candidate keys seen but not removed.
   - `cookie observe`: candidate cookies seen but not removed.
   - `click/open block`: actual blocked navigation behavior.
   - `dom block` on chapter pages: removed reader junk with `pageType`, `trigger`, and container summary.
6. Use **Copy debug** to capture a compact local snapshot for review.
7. Promote a rule only after repeated evidence:
   - candidate host -> `hardBlockHosts` and, if stable, `rules/static_rules.json`.
   - candidate selector -> `hardDomSelectors`.
   - candidate storage/cookie term -> suspicious storage/cookie terms.
8. Reload the site and verify core reading/navigation still works.

The MAIN-world `page_guard.js` is intentionally narrow. It runs through `chrome.scripting.registerContentScripts` with `world: "MAIN"` and `runAt: "document_start"` so it can patch `window.open`, but MAIN-world execution is still subject to page-world constraints and should stay small.

## Known Limitations

- Static DNR rules are JSON, so new static rules still require editing `rules/static_rules.json`; custom and profile dynamic hosts are reconciled at runtime.
- Profile modules are bundled local scripts. Adding a new profile does not require a manifest host permission edit, but it still requires adding the local profile script to the packaged extension code.
- DNR request counts depend on `declarativeNetRequest.onRuleMatchedDebug`, mainly useful in unpacked/debug builds.
- Profile selection UI is a placeholder for future management; the active profile is still determined by the current tab hostname.
- The page-level `window.open` guard runs in MAIN world through `chrome.scripting.registerContentScripts` at `document_start`. It uses bundled profile defaults; custom blocked hosts are handled by isolated content logic and DNR after reconciliation/reload.
- The MAIN-world navigation guard patches `window.open`, `HTMLAnchorElement.click`, `location.assign/replace`, and attempts to patch the `location.href` setter where Chrome allows it. Direct assignments such as `window.location.href = ...` are not reliably patchable in every MV3 page-world case, so the chapter click shield focuses on stopping the user-click event before delegated hijack handlers run.
- Observe-only events are best-effort. They come from visible DOM URLs, clicks, opens, storage/cookie scans, and DNR debug feedback; they are not a complete network capture.
- Mangakakalot heuristics are first-pass and conservative. Real-world tuning should be based on observed request hosts, overlay markup, and cookie/storage names.
