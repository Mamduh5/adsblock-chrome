(function installSiteShieldPageGuard() {
  "use strict";

  const script = document.currentScript;
  const rawConfig = script && script.dataset ? script.dataset.siteShieldProfile : "";
  const config = parseConfig(rawConfig);

  if (!config || !isProfileHost(location.hostname, config.domains, config.includeSubdomains) || window.__SITE_SHIELD_PAGE_GUARD_INSTALLED__) {
    return;
  }
  window.__SITE_SHIELD_PAGE_GUARD_INSTALLED__ = true;

  if (config.pageGuard && config.pageGuard.patchWindowOpen) {
    patchWindowOpen(config);
  }

  function patchWindowOpen(profileConfig) {
    const originalOpen = window.open;
    window.open = function guardedWindowOpen(url, target, features) {
      // This script is loaded as a web-accessible page script, so it runs in the
      // page's main world. A normal isolated-world content script cannot patch
      // page globals such as window.open reliably.
      if (isSuspiciousUrl(profileConfig, url)) {
        window.dispatchEvent(new CustomEvent("site-shield-open-blocked", {
          detail: {
            profileId: profileConfig.profileId,
            url: String(url || ""),
            target: String(target || "")
          }
        }));
        return null;
      }
      return originalOpen.call(window, url, target, features);
    };
  }

  function parseConfig(value) {
    try {
      return JSON.parse(value || "");
    } catch (error) {
      return null;
    }
  }

  function normalizeHost(hostname) {
    return String(hostname || "").trim().toLowerCase().replace(/^\.+/, "").replace(/\.+$/, "");
  }

  function isProfileHost(hostname, domains, includeSubdomains) {
    const host = normalizeHost(hostname);
    return (domains || []).some((domain) => {
      const root = normalizeHost(domain);
      return includeSubdomains ? host === root || host.endsWith("." + root) : host === root;
    });
  }

  function isBlockedHost(hostname, blockedHosts) {
    const host = normalizeHost(hostname);
    return (blockedHosts || []).some((blockedHost) => {
      const root = normalizeHost(blockedHost);
      return host === root || host.endsWith("." + root);
    });
  }

  function isSuspiciousUrl(profileConfig, url) {
    const rawUrl = String(url || "").trim();
    if (!rawUrl) {
      return false;
    }
    if (profileConfig.pageGuard && profileConfig.pageGuard.blockJavascriptUrls && /^javascript:/i.test(rawUrl)) {
      return true;
    }
    try {
      const parsed = new URL(rawUrl, location.href);
      if (isBlockedHost(parsed.hostname, profileConfig.blockedHosts)) {
        return true;
      }
      return Boolean(profileConfig.pageGuard && profileConfig.pageGuard.blockRedirectorUrls)
        && urlHasRedirectTerm(parsed, profileConfig.redirectUrlTerms)
        && Array.from(parsed.searchParams.values()).some((value) => /^https?:\/\//i.test(value));
    } catch (error) {
      return false;
    }
  }

  function urlHasRedirectTerm(url, terms) {
    const haystack = url.pathname + url.search;
    return (terms || []).some((term) => haystack.toLowerCase().includes(String(term || "").toLowerCase()));
  }
})();
