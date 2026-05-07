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

When debug logging is enabled, the background stores a bounded local event list in `chrome.storage.local`. Events include `profileId` and categories such as:

- `dnr_block`
- `click_block`
- `open_block`
- `dom_remove`
- `storage_remove`
- `cookie_remove`
- `manual_scrub`

The popup shows the newest events for the matched profile. Debug is off by default.

## Known Limitations

- Static DNR rules are JSON, so new static rules still require editing `rules/static_rules.json`; custom and profile dynamic hosts are reconciled at runtime.
- Profile modules are bundled local scripts. Adding a new profile does not require a manifest host permission edit, but it still requires adding the local profile script to the packaged extension code.
- DNR request counts depend on `declarativeNetRequest.onRuleMatchedDebug`, mainly useful in unpacked/debug builds.
- Profile selection UI is a placeholder for future management; the active profile is still determined by the current tab hostname.
- The page-level `window.open` guard runs in MAIN world through `chrome.scripting.registerContentScripts` at `document_start`. It uses bundled profile defaults; custom blocked hosts are handled by isolated content logic and DNR after reconciliation/reload.
- Mangakakalot heuristics are first-pass and conservative. Real-world tuning should be based on observed request hosts, overlay markup, and cookie/storage names.
