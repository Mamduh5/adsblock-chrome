(function exposeSiteShieldProfileSchema(globalScope) {
  "use strict";

  const DEFAULT_PROFILE = {
    id: "",
    displayName: "",
    description: "",
    matchPatterns: [],
    hostPermissionPatterns: [],
    domains: [],
    includeSubdomains: false,
    dnrInitiatorDomains: [],
    staticRuleIds: [],
    staticBlockedHosts: [],
    dynamicBlockedHosts: [],
    suspiciousDomSelectors: [],
    suspiciousTextTerms: [],
    suspiciousStorageKeyTerms: [],
    suspiciousCookieKeyTerms: [],
    protectedCookieTerms: [],
    pageGuard: {
      patchWindowOpen: false,
      blockJavascriptUrls: true,
      blockRedirectorUrls: true
    },
    tuning: {
      overlayMinZIndex: 1000,
      overlayMinViewportAreaRatio: 0.35,
      overlayWideWidthRatio: 0.85,
      overlayWideMinHeight: 120,
      redirectUrlTerms: ["redirect", "redir", "out", "go", "click", "track", "pop", "popup", "interstitial", "campaign", "promo"]
    }
  };

  function normalizeHost(hostname) {
    return String(hostname || "")
      .trim()
      .toLowerCase()
      .replace(/^\.+/, "")
      .replace(/\.+$/, "");
  }

  function normalizeList(values) {
    return Array.from(new Set((values || [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)));
  }

  function normalizeHostList(hosts) {
    return normalizeList(hosts)
      .map(normalizeHost)
      .filter((host) => host && !host.includes("/") && !host.includes("*"));
  }

  function mergeObjects(base, override) {
    return Object.assign({}, base || {}, override || {});
  }

  function normalizeProfile(profile) {
    const merged = Object.assign({}, DEFAULT_PROFILE, profile || {});
    merged.pageGuard = mergeObjects(DEFAULT_PROFILE.pageGuard, profile && profile.pageGuard);
    merged.tuning = mergeObjects(DEFAULT_PROFILE.tuning, profile && profile.tuning);
    merged.tuning.redirectUrlTerms = normalizeList(merged.tuning.redirectUrlTerms);
    merged.matchPatterns = normalizeList(merged.matchPatterns);
    merged.hostPermissionPatterns = normalizeList(merged.hostPermissionPatterns);
    merged.domains = normalizeHostList(merged.domains);
    merged.includeSubdomains = Boolean(merged.includeSubdomains);
    merged.dnrInitiatorDomains = normalizeHostList(merged.dnrInitiatorDomains.length ? merged.dnrInitiatorDomains : merged.domains);
    merged.staticRuleIds = (merged.staticRuleIds || [])
      .map((ruleId) => Number(ruleId))
      .filter((ruleId) => Number.isInteger(ruleId) && ruleId > 0);
    merged.staticBlockedHosts = normalizeHostList(merged.staticBlockedHosts);
    merged.dynamicBlockedHosts = normalizeHostList(merged.dynamicBlockedHosts);
    merged.suspiciousDomSelectors = normalizeList(merged.suspiciousDomSelectors);
    merged.suspiciousTextTerms = normalizeList(merged.suspiciousTextTerms);
    merged.suspiciousStorageKeyTerms = normalizeList(merged.suspiciousStorageKeyTerms);
    merged.suspiciousCookieKeyTerms = normalizeList(merged.suspiciousCookieKeyTerms);
    merged.protectedCookieTerms = normalizeList(merged.protectedCookieTerms);
    return merged;
  }

  function validateProfile(profile) {
    const normalized = normalizeProfile(profile);
    const missing = [];
    if (!normalized.id) missing.push("id");
    if (!normalized.displayName) missing.push("displayName");
    if (!normalized.matchPatterns.length) missing.push("matchPatterns");
    if (!normalized.hostPermissionPatterns.length) missing.push("hostPermissionPatterns");
    if (!normalized.domains.length) missing.push("domains");
    if (missing.length) {
      throw new Error("Invalid Site Shield profile; missing " + missing.join(", "));
    }
    return normalized;
  }

  globalScope.SiteShieldProfileSchema = {
    DEFAULT_PROFILE,
    normalizeHost,
    normalizeHostList,
    normalizeList,
    normalizeProfile,
    validateProfile
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
