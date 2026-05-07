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

  function urlHasRedirectTerm(url, terms) {
    const haystack = url.pathname + url.search;
    return (terms || []).some((term) => haystack.toLowerCase().includes(String(term || "").toLowerCase()));
  }
})();
