(function installSiteShieldPageGuard() {
  "use strict";

  const targetDomain = "example.com";
  const blockedHosts = [
    "ad-maven.com",
    "adnxs.com",
    "adservice.google.com",
    "adsterra.com",
    "doubleclick.net",
    "exoclick.com",
    "googlesyndication.com",
    "mgid.com",
    "onclickads.net",
    "outbrain.com",
    "popads.net",
    "propellerads.com",
    "redirectingat.com",
    "taboola.com",
    "trafficjunky.net",
    "yllix.com",
    "adf.ly",
    "bc.vc",
    "clk.sh",
    "linkbucks.com",
    "ouo.io",
    "shorte.st",
    "tinyium.com"
  ];

  if (!isTargetHost(location.hostname) || window.__SITE_SHIELD_PAGE_GUARD_INSTALLED__) {
    return;
  }
  window.__SITE_SHIELD_PAGE_GUARD_INSTALLED__ = true;

  const originalOpen = window.open;
  window.open = function guardedWindowOpen(url, target, features) {
    // Main-world guard for window.open abuse. Content scripts cannot reliably
    // replace page functions from the isolated world, so this small local script
    // is injected only after the extension confirms the target site is enabled.
    if (isSuspiciousUrl(url)) {
      window.dispatchEvent(new CustomEvent("site-shield-window-open-blocked", { detail: { url: String(url || "") } }));
      return null;
    }
    return originalOpen.call(window, url, target, features);
  };

  function isTargetHost(hostname) {
    const host = normalizeHost(hostname);
    return host === targetDomain || host.endsWith("." + targetDomain);
  }

  function normalizeHost(hostname) {
    return String(hostname || "").trim().toLowerCase().replace(/^\.+/, "").replace(/\.+$/, "");
  }

  function isBlockedHost(hostname) {
    const host = normalizeHost(hostname);
    return blockedHosts.some((blockedHost) => host === blockedHost || host.endsWith("." + blockedHost));
  }

  function isSuspiciousUrl(url) {
    const rawUrl = String(url || "").trim();
    if (!rawUrl) {
      return false;
    }
    if (/^javascript:/i.test(rawUrl)) {
      return true;
    }
    try {
      const parsed = new URL(rawUrl, location.href);
      if (isBlockedHost(parsed.hostname)) {
        return true;
      }
      return /(redirect|redir|out|go|click|track|pop|interstitial|campaign|promo)/i.test(parsed.pathname + parsed.search)
        && Array.from(parsed.searchParams.values()).some((value) => /^https?:\/\//i.test(value));
    } catch (error) {
      return false;
    }
  }
})();
