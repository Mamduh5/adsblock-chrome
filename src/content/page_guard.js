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

  installChapterClickShield(profile);
  patchLocationMethods(profile);

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
            action: "block",
            source: "window.open",
            clickCount: shieldState.clickCount,
            afterMutationBurst: isAfterMutationBurst(activeProfile)
          }
        }));
        return null;
      }
      return originalOpen.call(window, url, target, features);
    };
  }

  const shieldState = {
    clickCount: 0,
    lastMutationTime: 0,
    lastShieldedAt: 0
  };

  function installChapterClickShield(activeProfile) {
    const pageType = detectPageType(activeProfile);
    const rules = activeProfile.pageRules && activeProfile.pageRules[pageType];
    if (pageType !== "chapter" || !rules || !rules.clickShieldEnabled) {
      return;
    }

    new MutationObserver(() => {
      shieldState.lastMutationTime = Date.now();
    }).observe(document.documentElement || document, { childList: true, subtree: true });

    const events = rules.clickShieldEvents && rules.clickShieldEvents.length
      ? rules.clickShieldEvents
      : ["mousedown", "click", "auxclick"];

    for (const eventName of events) {
      document.addEventListener(eventName, (event) => {
        handleChapterShieldEvent(activeProfile, rules, event);
      }, true);
    }
  }

  function handleChapterShieldEvent(activeProfile, rules, event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || isAllowedReaderControl(rules, target)) {
      return;
    }

    const source = clickActionSource(target);
    const clickable = target.closest("a[href], button, [role='button'], [onclick], [data-href], [data-url]");
    const url = clickable ? clickable.getAttribute("href") || clickable.getAttribute("data-href") || clickable.getAttribute("data-url") || "" : "";
    const junk = url && isPageJunkUrl(activeProfile, url);
    const offsite = url && isOffsiteUrl(activeProfile, url);
    const readerClick = Boolean(rules.shieldPlainReaderClicks && isInsideReaderArea(rules, target));
    const largeSurface = isLargeClickSurface(target);

    if (!junk && !offsite && !readerClick && !largeSurface) {
      return;
    }

    shieldState.clickCount += event.type === "click" ? 1 : 0;
    shieldState.lastShieldedAt = Date.now();
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();

    window.dispatchEvent(new CustomEvent("site-shield-click-shielded", {
      detail: {
        profileId: activeProfile.id,
        action: "block",
        source,
        eventType: event.type,
        clickCount: shieldState.clickCount,
        afterMutationBurst: isAfterMutationBurst(activeProfile),
        url: String(url || ""),
        host: url ? getUrlHost(url) : "",
        reason: junk ? "junk_domain" : offsite ? "offsite_click" : readerClick ? "reader_delegated_click" : "large_click_surface",
        target: describeElement(target)
      }
    }));
  }

  function patchLocationMethods(activeProfile) {
    const locationPrototype = Object.getPrototypeOf(window.location);
    for (const method of ["assign", "replace"]) {
      try {
        const original = locationPrototype && locationPrototype[method];
        if (typeof original !== "function") {
          continue;
        }
        Object.defineProperty(locationPrototype, method, {
          configurable: true,
          value: function guardedLocationChange(url) {
            if (isGuardedClickWindow(activeProfile) && isSuspiciousUrl(activeProfile, url)) {
              window.dispatchEvent(new CustomEvent("site-shield-location-blocked", {
                detail: {
                  profileId: activeProfile.id,
                  action: "block",
                  source: "location." + method,
                  url: String(url || ""),
                  host: getUrlHost(url),
                  clickCount: shieldState.clickCount,
                  afterMutationBurst: isAfterMutationBurst(activeProfile)
                }
              }));
              return undefined;
            }
            return original.call(this, url);
          }
        });
      } catch (error) {
        window.dispatchEvent(new CustomEvent("site-shield-location-patch-failed", {
          detail: { profileId: activeProfile.id, action: "observe", source: "location." + method }
        }));
      }
    }
  }

  function isGuardedClickWindow(activeProfile) {
    const rules = activeProfile.pageRules && activeProfile.pageRules[detectPageType(activeProfile)];
    const burstMs = Number(rules && rules.shieldMutationBurstMs || 1200);
    return Date.now() - shieldState.lastShieldedAt <= burstMs;
  }

  function isAfterMutationBurst(activeProfile) {
    const rules = activeProfile.pageRules && activeProfile.pageRules[detectPageType(activeProfile)];
    const burstMs = Number(rules && rules.shieldMutationBurstMs || 1200);
    return Date.now() - shieldState.lastMutationTime <= burstMs;
  }

  function isAllowedReaderControl(rules, target) {
    for (const selector of (rules.overlayAllowSelectors || []).concat(rules.protectedSelectors || [])) {
      try {
        if (target.closest(selector)) {
          return true;
        }
      } catch (error) {
        return false;
      }
    }
    const link = target.closest("a[href]");
    if (!link) {
      return false;
    }
    const href = link.getAttribute("href") || "";
    return /^#/.test(href) || /\/manga\/[^/]+\/chapter-/i.test(href) || isFirstPartyUrl(href);
  }

  function isInsideReaderArea(rules, target) {
    for (const selector of rules.readerSelectors || []) {
      try {
        if (target.closest(selector)) {
          return true;
        }
      } catch (error) {
        return false;
      }
    }
    return target.tagName === "IMG";
  }

  function isLargeClickSurface(target) {
    const element = target.closest("a[href], [onclick], [role='button']") || target;
    if (!(element instanceof Element)) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width >= window.innerWidth * 0.65 && rect.height >= 160;
  }

  function clickActionSource(target) {
    if (target.closest("a[href]")) {
      return "anchor";
    }
    if (target.closest("[onclick], [role='button'], button")) {
      return "handler";
    }
    return "unknown";
  }

  function isOffsiteUrl(activeProfile, url) {
    const host = getUrlHost(url);
    return Boolean(host && !profiles.profileMatchesHostname(activeProfile, host));
  }

  function isFirstPartyUrl(url) {
    const host = getUrlHost(url);
    return !host || profiles.profileMatchesHostname(profile, host);
  }

  function getUrlHost(url) {
    try {
      return new URL(String(url || ""), location.href).hostname;
    } catch (error) {
      return "";
    }
  }

  function describeElement(node) {
    const id = node.id ? "#" + node.id : "";
    const className = typeof node.className === "string" && node.className ? "." + node.className.trim().replace(/\s+/g, ".") : "";
    return node.tagName.toLowerCase() + id + className;
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
