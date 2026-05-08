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
    hardBlockHosts: [],
    candidateBlockHosts: [],
    staticBlockedHosts: [],
    dynamicBlockedHosts: [],
    hardDomSelectors: [],
    candidateDomSelectors: [],
    suspiciousDomSelectors: [],
    suspiciousTextTerms: [],
    suspiciousStorageKeyTerms: [],
    candidateStorageKeyTerms: [],
    suspiciousCookieKeyTerms: [],
    candidateCookieKeyTerms: [],
    exactCookieNames: [],
    protectedCookieTerms: [],
    pageTypes: {},
    pageRules: {},
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
    merged.hardBlockHosts = normalizeHostList(merged.hardBlockHosts.length ? merged.hardBlockHosts : merged.staticBlockedHosts);
    merged.candidateBlockHosts = normalizeHostList(merged.candidateBlockHosts);
    merged.staticBlockedHosts = normalizeHostList(merged.staticBlockedHosts.length ? merged.staticBlockedHosts : merged.hardBlockHosts);
    merged.dynamicBlockedHosts = normalizeHostList(merged.dynamicBlockedHosts);
    merged.hardDomSelectors = normalizeList(merged.hardDomSelectors.length ? merged.hardDomSelectors : merged.suspiciousDomSelectors);
    merged.candidateDomSelectors = normalizeList(merged.candidateDomSelectors);
    merged.suspiciousDomSelectors = normalizeList(merged.suspiciousDomSelectors.length ? merged.suspiciousDomSelectors : merged.hardDomSelectors);
    merged.suspiciousTextTerms = normalizeList(merged.suspiciousTextTerms);
    merged.suspiciousStorageKeyTerms = normalizeList(merged.suspiciousStorageKeyTerms);
    merged.candidateStorageKeyTerms = normalizeList(merged.candidateStorageKeyTerms);
    merged.suspiciousCookieKeyTerms = normalizeList(merged.suspiciousCookieKeyTerms);
    merged.candidateCookieKeyTerms = normalizeList(merged.candidateCookieKeyTerms);
    merged.exactCookieNames = normalizeList(merged.exactCookieNames);
    merged.protectedCookieTerms = normalizeList(merged.protectedCookieTerms);
    merged.pageTypes = normalizePageTypes(merged.pageTypes);
    merged.pageRules = normalizePageRules(merged.pageRules);
    return merged;
  }

  function normalizePageTypes(pageTypes) {
    const normalized = {};
    for (const [pageType, rules] of Object.entries(pageTypes || {})) {
      normalized[pageType] = {
        pathRegex: String(rules && rules.pathRegex || "")
      };
    }
    return normalized;
  }

  function normalizePageRules(pageRules) {
    const normalized = {};
    for (const [pageType, rules] of Object.entries(pageRules || {})) {
      normalized[pageType] = {
        hardBlockHosts: normalizeHostList(rules && rules.hardBlockHosts || []),
        hardHostKeywords: normalizeList(rules && rules.hardHostKeywords || []),
        hardDomSelectors: normalizeList(rules && rules.hardDomSelectors || []),
        junkTextTerms: normalizeList(rules && rules.junkTextTerms || []),
        protectedSelectors: normalizeList(rules && rules.protectedSelectors || []),
        readerSelectors: normalizeList(rules && rules.readerSelectors || []),
        overlayAllowSelectors: normalizeList(rules && rules.overlayAllowSelectors || []),
        clickAllowSelectors: normalizeList(rules && rules.clickAllowSelectors || []),
        orphanSelectors: normalizeList(rules && rules.orphanSelectors || []),
        orphanTextTerms: normalizeList(rules && rules.orphanTextTerms || []),
        popupLayerSelectors: normalizeList(rules && rules.popupLayerSelectors || []),
        popupBackdropSelectors: normalizeList(rules && rules.popupBackdropSelectors || []),
        exactPopupSelectors: normalizeList(rules && rules.exactPopupSelectors || []),
        exactFullscreenOverlaySelectors: normalizeList(rules && rules.exactFullscreenOverlaySelectors || []),
        brokenIframeSelectors: normalizeList(rules && rules.brokenIframeSelectors || []),
        adBootstrapScriptUrls: normalizeList(rules && rules.adBootstrapScriptUrls || []),
        firstPartyAdScriptPaths: normalizeList(rules && rules.firstPartyAdScriptPaths || []),
        adContainerSelectors: normalizeList(rules && rules.adContainerSelectors || []),
        readerInjectedAdSelectors: normalizeList(rules && rules.readerInjectedAdSelectors || []),
        remainingBudgetKeys: normalizeList(rules && rules.remainingBudgetKeys || []),
        defaultDenyOffsiteNavigation: Boolean(rules && rules.defaultDenyOffsiteNavigation),
        blockPopupOpenByDefault: Boolean(rules && rules.blockPopupOpenByDefault),
        popupAllowSameOriginPaths: normalizeList(rules && rules.popupAllowSameOriginPaths || []),
        offsiteNavigationDenyHosts: normalizeHostList(rules && rules.offsiteNavigationDenyHosts || []),
        offsiteNavigationAllowHosts: normalizeHostList(rules && rules.offsiteNavigationAllowHosts || []),
        affiliateHintHosts: normalizeHostList(rules && rules.affiliateHintHosts || []),
        popupPromoTextTerms: normalizeList(rules && rules.popupPromoTextTerms || []),
        removalContainerSelectors: normalizeList(rules && rules.removalContainerSelectors || []),
        maxAnchorScansPerPass: Number(rules && rules.maxAnchorScansPerPass || 80),
        maxOverlayScansPerPass: Number(rules && rules.maxOverlayScansPerPass || 120),
        maxOrphanScansPerPass: Number(rules && rules.maxOrphanScansPerPass || 60),
        maxPopupScansPerPass: Number(rules && rules.maxPopupScansPerPass || 40),
        readerRectCacheMs: Number(rules && rules.readerRectCacheMs || 3000),
        overlayMinViewportWidthRatio: Number(rules && rules.overlayMinViewportWidthRatio || 0.75),
        overlayMinViewportHeightRatio: Number(rules && rules.overlayMinViewportHeightRatio || 0.45),
        overlayMinReaderOverlapRatio: Number(rules && rules.overlayMinReaderOverlapRatio || 0.25),
        overlayNearTransparentOpacity: Number(rules && rules.overlayNearTransparentOpacity || 0.12),
        clickShieldEnabled: rules && rules.clickShieldEnabled !== false,
        clickShieldEvents: normalizeList(rules && rules.clickShieldEvents || ["mousedown", "click", "auxclick"]),
        shieldPlainReaderClicks: rules && rules.shieldPlainReaderClicks !== false,
        shieldPlainChapterClicks: Boolean(rules && rules.shieldPlainChapterClicks),
        safeNavigateFirstPartyAnchors: rules && rules.safeNavigateFirstPartyAnchors !== false,
        shieldMutationBurstMs: Number(rules && rules.shieldMutationBurstMs || 1200)
      };
    }
    return normalized;
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
    normalizePageRules,
    normalizePageTypes,
    normalizeProfile,
    validateProfile
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
