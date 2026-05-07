(function exposeSiteShieldHeuristics(globalScope) {
  "use strict";

  const schema = globalScope.SiteShieldProfileSchema;

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function normalizeHost(hostname) {
    return schema.normalizeHost(hostname);
  }

  function normalizeHostList(hosts) {
    return schema.normalizeHostList(hosts);
  }

  function normalizeList(values) {
    return schema.normalizeList(values);
  }

  function isSubdomainOrSame(hostname, rootDomain) {
    const host = normalizeHost(hostname);
    const root = normalizeHost(rootDomain);
    return host === root || host.endsWith("." + root);
  }

  function getUrlHostname(url, baseUrl) {
    try {
      return new URL(url, baseUrl || "https://example.invalid/").hostname;
    } catch (error) {
      return "";
    }
  }

  function safeSelectorList(selectors) {
    return normalizeList(selectors)
      .filter((selector) => selector.length <= 300);
  }

  function profileBlockedHosts(profile, customHosts) {
    if (!profile) {
      return [];
    }
    return normalizeHostList((profile.staticBlockedHosts || [])
      .concat(profile.dynamicBlockedHosts || [])
      .concat(customHosts || []));
  }

  function isSuspiciousHost(profile, hostname, customHosts) {
    const host = normalizeHost(hostname);
    return profileBlockedHosts(profile, customHosts)
      .some((blockedHost) => isSubdomainOrSame(host, blockedHost));
  }

  function termPattern(terms, separatorAware) {
    const normalized = normalizeList(terms).map(escapeRegExp);
    if (!normalized.length) {
      return /$a/;
    }
    const body = "(" + normalized.join("|") + ")";
    if (!separatorAware) {
      return new RegExp(body, "i");
    }
    return new RegExp("(^|[._\\-:])" + body + "($|[._\\-:])", "i");
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

  function isSuspiciousUrl(profile, url, customHosts, baseUrl) {
    const rawUrl = String(url || "").trim();
    if (!rawUrl || !profile) {
      return false;
    }

    if (/^javascript:/i.test(rawUrl)) {
      return true;
    }

    let parsed;
    try {
      parsed = new URL(rawUrl, baseUrl || "https://example.invalid/");
    } catch (error) {
      return false;
    }

    if (isSuspiciousHost(profile, parsed.hostname, customHosts)) {
      return true;
    }

    const redirectPathPattern = termPattern(profile.tuning && profile.tuning.redirectUrlTerms, false);
    if (redirectPathPattern.test(parsed.pathname + parsed.search) && hasExternalUrlParam(parsed.href)) {
      return true;
    }

    return false;
  }

  function shouldScrubStorageKey(profile, key) {
    return termPattern(profile && profile.suspiciousStorageKeyTerms, true).test(String(key || "").trim());
  }

  function shouldScrubCookieName(profile, name) {
    const normalized = String(name || "").trim();
    const suspiciousPattern = termPattern(profile && profile.suspiciousCookieKeyTerms, true);
    const protectedPattern = termPattern(profile && profile.protectedCookieTerms, false);
    if (!suspiciousPattern.test(normalized)) {
      return false;
    }

    // Auth/session cookies are protected even if another suspicious term appears.
    // Profile authors should only relax this after confirming the cookie is safe.
    return !protectedPattern.test(normalized);
  }

  function textLooksLikeTrap(profile, text) {
    return termPattern(profile && profile.suspiciousTextTerms, false).test(String(text || "").trim());
  }

  function domNameLooksSuspicious(profile, value) {
    const terms = []
      .concat(profile && profile.suspiciousStorageKeyTerms || [])
      .concat(profile && profile.suspiciousCookieKeyTerms || [])
      .concat(["ad", "ads", "popup", "popunder", "overlay", "interstitial", "redirect", "promo", "campaign"]);
    return termPattern(terms, false).test(String(value || ""));
  }

  globalScope.SiteShieldHeuristics = {
    domNameLooksSuspicious,
    escapeRegExp,
    getUrlHostname,
    isSubdomainOrSame,
    isSuspiciousHost,
    isSuspiciousUrl,
    normalizeHost,
    normalizeHostList,
    normalizeList,
    profileBlockedHosts,
    safeSelectorList,
    shouldScrubCookieName,
    shouldScrubStorageKey,
    textLooksLikeTrap
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
