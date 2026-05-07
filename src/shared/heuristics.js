(function exposeSiteShieldHeuristics(globalScope) {
  "use strict";

  const config = globalScope.SiteShieldConfig;
  const separatorPattern = "(^|[._\\-:])";
  const endSeparatorPattern = "($|[._\\-:])";
  const storageTermPattern = new RegExp(
    separatorPattern + "(" + config.SUSPICIOUS_STORAGE_TERMS.map(escapeRegExp).join("|") + ")" + endSeparatorPattern,
    "i"
  );
  const protectedCookiePattern = new RegExp(
    "(" + config.PROTECTED_COOKIE_TERMS.map(escapeRegExp).join("|") + ")",
    "i"
  );
  const redirectPathPattern = new RegExp(config.REDIRECT_URL_PATTERN, "i");
  const trapTextPattern = new RegExp(config.TRAP_TEXT_PATTERN, "i");

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function normalizeHost(hostname) {
    return String(hostname || "")
      .trim()
      .toLowerCase()
      .replace(/^\.+/, "")
      .replace(/\.+$/, "");
  }

  function isTargetHostname(hostname) {
    const host = normalizeHost(hostname);
    return host === config.TARGET_DOMAIN || host.endsWith("." + config.TARGET_DOMAIN);
  }

  function isSubdomainOrSame(hostname, rootDomain) {
    const host = normalizeHost(hostname);
    const root = normalizeHost(rootDomain);
    return host === root || host.endsWith("." + root);
  }

  function getUrlHostname(url, baseUrl) {
    try {
      return new URL(url, baseUrl || "https://" + config.TARGET_DOMAIN + "/").hostname;
    } catch (error) {
      return "";
    }
  }

  function normalizeHostList(hosts) {
    return Array.from(new Set((hosts || [])
      .map((host) => normalizeHost(host))
      .filter(Boolean)
      .filter((host) => !host.includes("/") && !host.includes("*"))));
  }

  function isSuspiciousHost(hostname, customHosts) {
    const host = normalizeHost(hostname);
    const blockedHosts = config.BAD_THIRD_PARTY_HOSTS
      .concat(config.REDIRECT_HOSTS)
      .concat(normalizeHostList(customHosts));

    return blockedHosts.some((blockedHost) => isSubdomainOrSame(host, blockedHost));
  }

  function hasExternalUrlParam(url) {
    try {
      const parsed = new URL(url);
      for (const value of parsed.searchParams.values()) {
        if (/^https?:\/\//i.test(value)) {
          return true;
        }
      }
    } catch (error) {
      return false;
    }
    return false;
  }

  function isSuspiciousUrl(url, customHosts, baseUrl) {
    const rawUrl = String(url || "").trim();
    if (!rawUrl) {
      return false;
    }

    if (/^javascript:/i.test(rawUrl)) {
      return true;
    }

    let parsed;
    try {
      parsed = new URL(rawUrl, baseUrl || "https://" + config.TARGET_DOMAIN + "/");
    } catch (error) {
      return false;
    }

    if (isSuspiciousHost(parsed.hostname, customHosts)) {
      return true;
    }

    if (redirectPathPattern.test(parsed.pathname + parsed.search) && hasExternalUrlParam(parsed.href)) {
      return true;
    }

    return false;
  }

  function shouldScrubStorageKey(key) {
    const normalized = String(key || "").trim();
    return storageTermPattern.test(normalized);
  }

  function shouldScrubCookieName(name) {
    const normalized = String(name || "").trim();
    if (!storageTermPattern.test(normalized)) {
      return false;
    }

    // Auth/session cookies are protected even if their names contain words like "campaign".
    // Tune this list only after confirming a cookie is not needed for sign-in or playback.
    return !protectedCookiePattern.test(normalized);
  }

  function textLooksLikeTrap(text) {
    return trapTextPattern.test(String(text || "").trim());
  }

  function safeSelectorList(selectors) {
    return (selectors || [])
      .map((selector) => String(selector || "").trim())
      .filter(Boolean)
      .filter((selector) => selector.length <= 300);
  }

  globalScope.SiteShieldHeuristics = {
    escapeRegExp,
    getUrlHostname,
    isSubdomainOrSame,
    isSuspiciousHost,
    isSuspiciousUrl,
    isTargetHostname,
    normalizeHost,
    normalizeHostList,
    safeSelectorList,
    shouldScrubCookieName,
    shouldScrubStorageKey,
    textLooksLikeTrap
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
