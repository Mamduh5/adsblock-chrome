(function installSiteShieldPageGuard() {
  "use strict";

  const profiles = globalThis.SiteShieldProfiles;
  const heuristics = globalThis.SiteShieldHeuristics;
  const profile = profiles && profiles.findByHostname(location.hostname);

  if (!profile || window.__SITE_SHIELD_PAGE_GUARD_INSTALLED__) {
    return;
  }
  window.__SITE_SHIELD_PAGE_GUARD_INSTALLED__ = true;

  if (profile.pageGuard && profile.pageGuard.patchWindowOpen) {
    patchWindowOpen(profile);
  }

  function patchWindowOpen(activeProfile) {
    const originalOpen = window.open;
    window.open = function guardedWindowOpen(url, target, features) {
      // Registered dynamically with world: "MAIN", so this runs in the page
      // execution world and can patch page globals such as window.open.
      if (isCandidateUrl(activeProfile, url)) {
        window.dispatchEvent(new CustomEvent("site-shield-open-observed", {
          detail: {
            profileId: activeProfile.id,
            url: String(url || ""),
            target: String(target || ""),
            action: "observe"
          }
        }));
      }
      if (isSuspiciousUrl(activeProfile, url)) {
        window.dispatchEvent(new CustomEvent("site-shield-open-blocked", {
          detail: {
            profileId: activeProfile.id,
            url: String(url || ""),
            target: String(target || ""),
            action: "block"
          }
        }));
        return null;
      }
      return originalOpen.call(window, url, target, features);
    };
  }

  function isSuspiciousUrl(activeProfile, url) {
    const rawUrl = String(url || "").trim();
    if (!rawUrl) {
      return false;
    }
    if (activeProfile.pageGuard && activeProfile.pageGuard.blockJavascriptUrls && /^javascript:/i.test(rawUrl)) {
      return true;
    }
    try {
      const parsed = new URL(rawUrl, location.href);
      if (heuristics.isSuspiciousHost(activeProfile, parsed.hostname, [])) {
        return true;
      }
      if (isPageJunkUrl(activeProfile, parsed.href)) {
        return true;
      }
      return Boolean(activeProfile.pageGuard && activeProfile.pageGuard.blockRedirectorUrls)
        && urlHasRedirectTerm(parsed, activeProfile.tuning && activeProfile.tuning.redirectUrlTerms)
        && Array.from(parsed.searchParams.values()).some((value) => /^https?:\/\//i.test(value));
    } catch (error) {
      return false;
    }
  }

  function isCandidateUrl(activeProfile, url) {
    const rawUrl = String(url || "").trim();
    if (!rawUrl) {
      return false;
    }
    try {
      const parsed = new URL(rawUrl, location.href);
      return heuristics.isCandidateHost(activeProfile, parsed.hostname);
    } catch (error) {
      return false;
    }
  }

  function isPageJunkUrl(activeProfile, url) {
    const pageType = detectPageType(activeProfile);
    const rules = activeProfile.pageRules && activeProfile.pageRules[pageType];
    if (!rules) {
      return false;
    }

    const rawUrl = String(url || "");
    let parsed;
    try {
      parsed = new URL(rawUrl, location.href);
    } catch (error) {
      return false;
    }

    const haystack = (parsed.href + " " + parsed.hostname).toLowerCase();
    for (const junkHost of rules.hardBlockHosts || []) {
      if (heuristics.isSubdomainOrSame(parsed.hostname, junkHost) || haystack.includes(String(junkHost).toLowerCase())) {
        return true;
      }
    }
    return (rules.hardHostKeywords || []).some((keyword) => haystack.includes(String(keyword).toLowerCase()));
  }

  function detectPageType(activeProfile) {
    for (const [pageType, rule] of Object.entries(activeProfile.pageTypes || {})) {
      if (!rule || !rule.pathRegex) {
        continue;
      }
      try {
        if (new RegExp(rule.pathRegex, "i").test(location.pathname)) {
          return pageType;
        }
      } catch (error) {
        return "unknown";
      }
    }
    return "unknown";
  }

  function urlHasRedirectTerm(url, terms) {
    const haystack = url.pathname + url.search;
    return (terms || []).some((term) => haystack.toLowerCase().includes(String(term || "").toLowerCase()));
  }
})();
