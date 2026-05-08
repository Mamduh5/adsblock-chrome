(function installSiteShieldPageGuard() {
  "use strict";

  const profiles = globalThis.SiteShieldProfiles;
  const heuristics = globalThis.SiteShieldHeuristics;
  const profile = profiles && profiles.findByHostname(resolveContextHostname());

  if (!profile || window.__SITE_SHIELD_PAGE_GUARD_INSTALLED__) {
    return;
  }
  window.__SITE_SHIELD_PAGE_GUARD_INSTALLED__ = true;

  const shieldState = {
    clickCount: 0,
    clickSerial: 0,
    openAttemptsForClick: 0,
    lastUserClickAt: 0,
    lastMutationTime: 0,
    lastShieldedAt: 0
  };

  if (profile.pageGuard && profile.pageGuard.patchWindowOpen) {
    patchWindowOpen(profile);
    patchAnchorClick(profile);
  }

  installChapterClickShield(profile);
  installChapterRequestGuards(profile);
  installChapterElementCreationGuards(profile);
  patchLocationMethods(profile);
  patchLocationHref(profile);

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
      if (shouldBlockWindowOpen(activeProfile, url)) {
        const attempt = markBlockedOpenAttempt();
        const details = blockDetails(activeProfile, url, "window_open", target, features);
        window.dispatchEvent(new CustomEvent("site-shield-open-blocked", {
          detail: Object.assign(details, {
            profileId: activeProfile.id,
            url: String(url || ""),
            target: String(target || ""),
            action: "block",
            source: "window_open",
            fakePopupReturned: true,
            clickCount: shieldState.clickCount,
            clickSerial: shieldState.clickSerial,
            duplicateAttempt: attempt.duplicateAttempt,
            openAttemptsForClick: attempt.openAttemptsForClick,
            afterMutationBurst: isAfterMutationBurst(activeProfile)
          })
        }));
        return createFakePopupWindow();
      }
      return originalOpen.call(window, url, target, features);
    };
  }

  function patchAnchorClick(activeProfile) {
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function guardedAnchorClick() {
      const href = this.getAttribute("href") || "";
      if (shouldBlockNavigation(activeProfile, href)) {
        const attempt = markBlockedOpenAttempt();
        const details = blockDetails(activeProfile, href, this.getAttribute("target") === "_blank" ? "anchor_blank" : "anchor_click");
        window.dispatchEvent(new CustomEvent("site-shield-open-blocked", {
          detail: Object.assign(details, {
            profileId: activeProfile.id,
            action: "block",
            source: this.getAttribute("target") === "_blank" ? "anchor_blank" : "anchor_click",
            url: String(href || ""),
            host: getUrlHost(href),
            target: String(this.getAttribute("target") || ""),
            clickCount: shieldState.clickCount,
            clickSerial: shieldState.clickSerial,
            duplicateAttempt: attempt.duplicateAttempt,
            openAttemptsForClick: attempt.openAttemptsForClick,
            afterMutationBurst: isAfterMutationBurst(activeProfile)
          })
        }));
        return undefined;
      }
      return originalClick.call(this);
    };
  }

  function installChapterRequestGuards(activeProfile) {
    if (!isChapterContext(activeProfile)) {
      return;
    }
    patchFetch(activeProfile);
    patchXhr(activeProfile);
    patchSendBeacon(activeProfile);
  }

  function installChapterElementCreationGuards(activeProfile) {
    if (!isChapterContext(activeProfile)) {
      return;
    }
    patchCreateElement(activeProfile);
    patchElementSetAttribute(activeProfile);
    patchElementSrcSetter(activeProfile, HTMLScriptElement, "script");
    patchElementSrcSetter(activeProfile, HTMLIFrameElement, "iframe");
    patchNodeInsertion(activeProfile, "appendChild");
    patchNodeInsertion(activeProfile, "insertBefore");
  }

  function patchCreateElement(activeProfile) {
    if (!Document.prototype || typeof Document.prototype.createElement !== "function") {
      return;
    }
    const originalCreateElement = Document.prototype.createElement;
    Document.prototype.createElement = function guardedCreateElement(tagName, options) {
      const element = originalCreateElement.call(this, tagName, options);
      const tag = String(tagName || "").toLowerCase();
      if (tag === "script" || tag === "iframe") {
        try {
          element.setAttribute("data-site-shield-created", "true");
        } catch (error) {
          return element;
        }
      }
      return element;
    };
  }

  function patchElementSetAttribute(activeProfile) {
    if (!Element.prototype || typeof Element.prototype.setAttribute !== "function") {
      return;
    }
    const originalSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function guardedSetAttribute(name, value) {
      const attrName = String(name || "").toLowerCase();
      if (attrName === "src" && isGuardedMediaElement(this)) {
        const tag = this.tagName.toLowerCase();
        const source = tag + "_setAttribute";
        if (shouldDenyDynamicElementUrl(activeProfile, tag, value)) {
          neutralizeDynamicElement(activeProfile, this, tag, value, source);
          return undefined;
        }
      }
      return originalSetAttribute.apply(this, arguments);
    };
  }

  function patchElementSrcSetter(activeProfile, constructor, tag) {
    if (typeof constructor !== "function" || !constructor.prototype) {
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(constructor.prototype, "src")
      || Object.getOwnPropertyDescriptor(HTMLElement.prototype, "src");
    if (!descriptor || typeof descriptor.set !== "function" || typeof descriptor.get !== "function") {
      return;
    }
    try {
      Object.defineProperty(constructor.prototype, "src", {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: function getGuardedSrc() {
          return descriptor.get.call(this);
        },
        set: function setGuardedSrc(value) {
          if (shouldDenyDynamicElementUrl(activeProfile, tag, value)) {
            neutralizeDynamicElement(activeProfile, this, tag, value, tag + "_src_setter");
            return undefined;
          }
          return descriptor.set.call(this, value);
        }
      });
    } catch (error) {
      return;
    }
  }

  function patchNodeInsertion(activeProfile, method) {
    if (!Node.prototype || typeof Node.prototype[method] !== "function") {
      return;
    }
    const original = Node.prototype[method];
    Node.prototype[method] = function guardedNodeInsertion(node, referenceNode) {
      if (node instanceof Element && isGuardedMediaElement(node)) {
        const tag = node.tagName.toLowerCase();
        const src = node.getAttribute("src") || node.src || "";
        if (shouldDenyDynamicElementUrl(activeProfile, tag, src)) {
          neutralizeDynamicElement(activeProfile, node, tag, src, method);
          return node;
        }
      }
      return method === "insertBefore"
        ? original.call(this, node, referenceNode)
        : original.call(this, node);
    };
  }

  function patchFetch(activeProfile) {
    if (typeof window.fetch !== "function") {
      return;
    }
    const originalFetch = window.fetch;
    window.fetch = function guardedFetch(input, init) {
      const url = requestUrl(input);
      if (shouldBlockRequestUrl(activeProfile, url)) {
        dispatchRequestBlocked(activeProfile, "fetch", url);
        return Promise.reject(new TypeError("Site Shield blocked chapter request"));
      }
      return originalFetch.call(this, input, init);
    };
  }

  function patchXhr(activeProfile) {
    if (typeof XMLHttpRequest !== "function") {
      return;
    }
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function guardedXhrOpen(method, url) {
      this.__siteShieldUrl = String(url || "");
      this.__siteShieldRequestBlocked = shouldBlockRequestUrl(activeProfile, url);
      if (this.__siteShieldRequestBlocked) {
        dispatchRequestBlocked(activeProfile, "xhr", url);
      }
      return originalOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function guardedXhrSend() {
      if (this.__siteShieldRequestBlocked) {
        return undefined;
      }
      return originalSend.apply(this, arguments);
    };
  }

  function patchSendBeacon(activeProfile) {
    if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") {
      return;
    }
    const originalBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function guardedSendBeacon(url, data) {
      if (shouldBlockRequestUrl(activeProfile, url)) {
        dispatchRequestBlocked(activeProfile, "beacon", url);
        return false;
      }
      return originalBeacon(url, data);
    };
  }

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

    const targets = new Set([window, document, document.documentElement].filter(Boolean));
    if (document.body) {
      targets.add(document.body);
    }

    document.addEventListener("DOMContentLoaded", () => {
      if (document.body) {
        for (const eventName of events) {
          document.body.addEventListener(eventName, (event) => {
            handleChapterShieldEvent(activeProfile, rules, event);
          }, true);
        }
      }
    }, { once: true });

    for (const eventName of events) {
      for (const target of targets) {
        target.addEventListener(eventName, (event) => {
          handleChapterShieldEvent(activeProfile, rules, event);
        }, true);
      }
    }
  }

  function handleChapterShieldEvent(activeProfile, rules, event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }

    const allowed = allowedChapterAction(activeProfile, rules, target);
    if (allowed.allowed) {
      handleAllowedChapterAction(activeProfile, rules, event, target, allowed);
      return;
    }

    const source = clickActionSource(target);
    const clickable = target.closest("a[href], button, [role='button'], [onclick], [data-href], [data-url]");
    const url = clickable ? clickable.getAttribute("href") || clickable.getAttribute("data-href") || clickable.getAttribute("data-url") || "" : "";
    const junk = url && isPageJunkUrl(activeProfile, url);
    const floater = url && isFloaterUrl(url);
    const affiliate = url && isAffiliateNavigationUrl(activeProfile, url);
    const offsite = url && isOffsiteUrl(activeProfile, url);
    const readerClick = Boolean(rules.shieldPlainReaderClicks && isInsideReaderArea(rules, target));
    const plainChapterClick = Boolean(rules.shieldPlainChapterClicks && !url);
    const largeSurface = isLargeClickSurface(target);

    if (!junk && !floater && !affiliate && !offsite && !readerClick && !plainChapterClick && !largeSurface) {
      return;
    }

    markShieldedClick(event);
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
        clickSerial: shieldState.clickSerial,
        afterMutationBurst: isAfterMutationBurst(activeProfile),
        url: String(url || ""),
        host: url ? getUrlHost(url) : "",
        reason: floater ? "floater_anchor" : affiliate ? "affiliate_host" : junk ? "junk_domain" : offsite ? "offsite_click" : readerClick ? "reader_delegated_click" : plainChapterClick ? "chapter_plain_click" : "large_click_surface",
        affiliateHost: affiliate,
        target: describeElement(target)
      }
    }));
  }

  function handleAllowedChapterAction(activeProfile, rules, event, target, allowed) {
    const link = allowed.link;
    const href = link ? link.getAttribute("href") || "" : "";
    if (!link || !rules.safeNavigateFirstPartyAnchors) {
      return;
    }

    // First-party chapter/control links are navigated by the guard itself.
    // This preserves real navigation while preventing page-level delegated
    // click listeners from opening a scam tab off the same user gesture.
    markShieldedClick(event);
    shieldState.lastShieldedAt = Date.now();
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();

    window.dispatchEvent(new CustomEvent("site-shield-click-shielded", {
      detail: {
        profileId: activeProfile.id,
        action: "allow_safe_navigate",
        source: "anchor_first_party",
        eventType: event.type,
        clickCount: shieldState.clickCount,
        clickSerial: shieldState.clickSerial,
        afterMutationBurst: isAfterMutationBurst(activeProfile),
        url: String(href || ""),
        host: getUrlHost(href),
        reason: allowed.reason,
        target: describeElement(target)
      }
    }));

    if (event.type === "click") {
      safeNavigate(href);
    }
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
            if (shouldBlockNavigation(activeProfile, url)) {
              const attempt = markBlockedOpenAttempt();
              const details = blockDetails(activeProfile, url, method === "assign" ? "location_assign" : "location_replace");
              window.dispatchEvent(new CustomEvent("site-shield-location-blocked", {
                detail: Object.assign(details, {
                  profileId: activeProfile.id,
                  action: "block",
                  source: method === "assign" ? "location_assign" : "location_replace",
                  url: String(url || ""),
                  host: getUrlHost(url),
                  clickCount: shieldState.clickCount,
                  clickSerial: shieldState.clickSerial,
                  duplicateAttempt: attempt.duplicateAttempt,
                  openAttemptsForClick: attempt.openAttemptsForClick,
                  afterMutationBurst: isAfterMutationBurst(activeProfile)
                })
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

  function patchLocationHref(activeProfile) {
    const locationPrototype = Object.getPrototypeOf(window.location);
    const descriptor = locationPrototype && Object.getOwnPropertyDescriptor(locationPrototype, "href");
    if (!descriptor || typeof descriptor.set !== "function" || typeof descriptor.get !== "function") {
      window.dispatchEvent(new CustomEvent("site-shield-location-patch-failed", {
        detail: { profileId: activeProfile.id, action: "observe", source: "location_href" }
      }));
      return;
    }

    try {
      Object.defineProperty(locationPrototype, "href", {
        configurable: true,
        get: function getGuardedHref() {
          return descriptor.get.call(this);
        },
        set: function setGuardedHref(url) {
          if (shouldBlockNavigation(activeProfile, url)) {
            const attempt = markBlockedOpenAttempt();
            const details = blockDetails(activeProfile, url, "location_href");
            window.dispatchEvent(new CustomEvent("site-shield-location-blocked", {
              detail: Object.assign(details, {
                profileId: activeProfile.id,
                action: "block",
                source: "location_href",
                url: String(url || ""),
                host: getUrlHost(url),
                clickCount: shieldState.clickCount,
                clickSerial: shieldState.clickSerial,
                duplicateAttempt: attempt.duplicateAttempt,
                openAttemptsForClick: attempt.openAttemptsForClick,
                afterMutationBurst: isAfterMutationBurst(activeProfile)
              })
            }));
            return undefined;
          }
          return descriptor.set.call(this, url);
        }
      });
    } catch (error) {
      window.dispatchEvent(new CustomEvent("site-shield-location-patch-failed", {
        detail: { profileId: activeProfile.id, action: "observe", source: "location_href" }
      }));
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

  function beginClickSequence() {
    shieldState.clickCount += 1;
    shieldState.clickSerial += 1;
    shieldState.openAttemptsForClick = 0;
    shieldState.lastUserClickAt = Date.now();
  }

  function markShieldedClick(event) {
    if (event.type === "pointerdown" || event.type === "mousedown" || (event.type === "click" && Date.now() - shieldState.lastUserClickAt > 500)) {
      beginClickSequence();
    }
  }

  function markBlockedOpenAttempt() {
    if (Date.now() - shieldState.lastUserClickAt > 1500) {
      shieldState.openAttemptsForClick = 0;
    }
    shieldState.openAttemptsForClick += 1;
    return {
      duplicateAttempt: shieldState.openAttemptsForClick > 1,
      openAttemptsForClick: shieldState.openAttemptsForClick
    };
  }

  function allowedChapterAction(activeProfile, rules, target) {
    for (const selector of rules.clickAllowSelectors || []) {
      try {
        if (target.closest(selector)) {
          const link = target.closest("a[href]");
          if (link && isFirstPartyUrl(link.getAttribute("href") || "")) {
            return { allowed: true, link, reason: "allowlisted_first_party_control" };
          }
          return { allowed: true, link: null, reason: "allowlisted_control" };
        }
      } catch (error) {
        return { allowed: false, link: null, reason: "" };
      }
    }
    const link = target.closest("a[href]");
    if (!link) {
      return { allowed: false, link: null, reason: "" };
    }
    const href = link.getAttribute("href") || "";
    if (/^#/.test(href) || /\/manga\/[^/]+\/chapter-/i.test(href) || isFirstPartyUrl(href)) {
      return { allowed: true, link, reason: "first_party_link" };
    }
    return { allowed: false, link: null, reason: "" };
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

  function isBlockedBlankPopup(activeProfile, url) {
    if (!isChapterContext(activeProfile)) {
      return false;
    }
    const rawUrl = String(url == null ? "" : url).trim();
    return rawUrl === "" || /^about:blank(?:[#?].*)?$/i.test(rawUrl);
  }

  function shouldBlockWindowOpen(activeProfile, url) {
    if (!isChapterContext(activeProfile)) {
      return isBlockedBlankPopup(activeProfile, url) || shouldBlockNavigation(activeProfile, url);
    }

    const rules = activeProfile.pageRules && activeProfile.pageRules.chapter || {};
    if (rules.blockPopupOpenByDefault !== false && !isAllowedChapterPopup(activeProfile, url)) {
      return true;
    }
    return isBlockedBlankPopup(activeProfile, url) || shouldBlockNavigation(activeProfile, url);
  }

  function isAllowedChapterPopup(activeProfile, url) {
    const rules = activeProfile.pageRules && activeProfile.pageRules.chapter || {};
    const allowPaths = rules.popupAllowSameOriginPaths || [];
    if (!allowPaths.length) {
      return false;
    }

    const parsed = parseUrl(url);
    if (!parsed) {
      return false;
    }
    if (!profiles.profileMatchesHostname(activeProfile, parsed.hostname)) {
      return false;
    }
    return allowPaths.some((pathPrefix) => parsed.pathname.startsWith(String(pathPrefix || "")));
  }

  function shouldBlockNavigation(activeProfile, url) {
    const pageType = detectPageType(activeProfile);
    if (isFloaterUrl(url) || isSuspiciousUrl(activeProfile, url) || isAffiliateNavigationUrl(activeProfile, url)) {
      return true;
    }
    if (pageType !== "chapter") {
      return isGuardedClickWindow(activeProfile) && isOffsiteUrl(activeProfile, url);
    }
    const rules = activeProfile.pageRules && activeProfile.pageRules.chapter || {};
    return Boolean(rules.defaultDenyOffsiteNavigation && isOffsiteUrl(activeProfile, url) && !isExplicitlyAllowedOffsite(activeProfile, url));
  }

  function shouldBlockRequestUrl(activeProfile, url) {
    return isFloaterUrl(url) || isAffiliateNavigationUrl(activeProfile, url);
  }

  function isGuardedMediaElement(node) {
    return node instanceof Element && (node.tagName === "SCRIPT" || node.tagName === "IFRAME");
  }

  function shouldDenyDynamicElementUrl(activeProfile, tag, url) {
    const rawUrl = String(url || "").trim();
    if (!rawUrl) {
      return false;
    }
    const host = getUrlHost(rawUrl);
    if (!host) {
      return false;
    }
    const rules = activeProfile.pageRules && activeProfile.pageRules[detectPageType(activeProfile)]
      || activeProfile.pageRules && activeProfile.pageRules.chapter
      || {};
    const deniedHosts = (rules.dynamicElementDenyHosts || []).concat(rules.offsiteNavigationDenyHosts || []);
    return deniedHosts.some((denyHost) => heuristics.isSubdomainOrSame(host, denyHost))
      || isFloaterUrl(rawUrl)
      || isAffiliateNavigationUrl(activeProfile, rawUrl);
  }

  function neutralizeDynamicElement(activeProfile, node, tag, url, source) {
    try {
      if (tag === "script") {
        node.type = "text/plain";
      }
      node.removeAttribute("src");
      node.setAttribute("data-site-shield-dynamic-denied", "true");
      if (tag === "iframe") {
        node.setAttribute("src", "about:blank");
      }
    } catch (error) {
      return;
    }
    dispatchDynamicSrcDenied(activeProfile, tag, url, source);
  }

  function isAffiliateNavigationUrl(activeProfile, url) {
    const host = getUrlHost(url);
    if (!host) {
      return false;
    }
    const rules = activeProfile.pageRules && activeProfile.pageRules[detectPageType(activeProfile)]
      || activeProfile.pageRules && activeProfile.pageRules.chapter
      || {};
    return (rules.offsiteNavigationDenyHosts || []).some((denyHost) => heuristics.isSubdomainOrSame(host, denyHost));
  }

  function isExplicitlyAllowedOffsite(activeProfile, url) {
    const host = getUrlHost(url);
    if (!host) {
      return false;
    }
    const rules = activeProfile.pageRules && activeProfile.pageRules[detectPageType(activeProfile)]
      || activeProfile.pageRules && activeProfile.pageRules.chapter
      || {};
    return (rules.offsiteNavigationAllowHosts || []).some((allowHost) => heuristics.isSubdomainOrSame(host, allowHost));
  }

  function blockDetails(activeProfile, url, source, target, features) {
    const rawUrl = String(url || "");
    const host = getUrlHost(url);
    const blankPopup = source === "window_open" && isBlockedBlankPopup(activeProfile, url);
    const floater = isFloaterUrl(url);
    const affiliateHost = isAffiliateNavigationUrl(activeProfile, url);
    const offsite = Boolean(host && !profiles.profileMatchesHostname(activeProfile, host));
    const sameOrigin = Boolean(host && profiles.profileMatchesHostname(activeProfile, host));
    return {
      host,
      blankPopup,
      floater,
      affiliateHost,
      offsite,
      sameOrigin,
      popupDefaultDenied: source === "window_open" && isChapterContext(activeProfile),
      frameContext: window.top !== window,
      reason: blankPopup ? "blank_popup" : floater ? "floater" : affiliateHost ? "affiliate_host" : offsite ? "offsite_top_navigation" : "popup_default_deny",
      rawArgs: [
        trimArg(url),
        trimArg(target),
        trimArg(features)
      ],
      url: rawUrl
    };
  }

  function trimArg(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, 160);
  }

  function createFakePopupWindow() {
    const noop = function siteShieldNoop() {};
    const locationStub = {};
    try {
      Object.defineProperties(locationStub, {
        href: { configurable: true, enumerable: true, get: () => "about:blank", set: noop },
        assign: { configurable: true, enumerable: true, value: noop },
        replace: { configurable: true, enumerable: true, value: noop },
        reload: { configurable: true, enumerable: true, value: noop },
        toString: { configurable: true, value: () => "about:blank" }
      });
    } catch (error) {
      return null;
    }

    const documentStub = {
      open: noop,
      close: noop,
      write: noop,
      writeln: noop
    };
    const popupStub = {
      closed: false,
      opener: null,
      location: locationStub,
      document: documentStub,
      focus: noop,
      blur: noop,
      close: noop,
      postMessage: noop
    };
    popupStub.self = popupStub;
    popupStub.window = popupStub;
    popupStub.top = popupStub;
    popupStub.parent = popupStub;

    try {
      Object.defineProperty(popupStub, "location", {
        configurable: true,
        enumerable: true,
        get: () => locationStub,
        set: noop
      });
    } catch (error) {
      return popupStub;
    }

    if (typeof Proxy !== "function") {
      return popupStub;
    }
    return new Proxy(popupStub, {
      get(target, prop) {
        if (prop in target) {
          return target[prop];
        }
        if (prop === Symbol.toStringTag) {
          return "Window";
        }
        return noop;
      },
      set() {
        return true;
      },
      has() {
        return true;
      }
    });
  }

  function isFirstPartyUrl(url) {
    const host = getUrlHost(url);
    if (!host) {
      return !/^(javascript|data|blob):/i.test(String(url || "").trim());
    }
    return profiles.profileMatchesHostname(profile, host);
  }

  function safeNavigate(url) {
    try {
      if (!url || /^#/.test(url)) {
        return;
      }
      const parsed = new URL(String(url), location.href);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return;
      }
      if (parsed.href === location.href) {
        return;
      }
      window.setTimeout(() => {
        window.location.assign(parsed.href);
      }, 0);
    } catch (error) {
      return;
    }
  }

  function getUrlHost(url) {
    const parsed = parseUrl(url);
    return parsed ? parsed.hostname : "";
  }

  function requestUrl(input) {
    if (typeof input === "string" || input instanceof URL) {
      return String(input);
    }
    if (input && typeof input.url === "string") {
      return input.url;
    }
    return "";
  }

  function isFloaterUrl(url) {
    const parsed = parseUrl(url);
    return Boolean(parsed && parsed.hostname === "oundhertobeconsist.org" && /^\/floater(?:\/|$)/i.test(parsed.pathname));
  }

  function isChubbyGetUrl(url) {
    const parsed = parseUrl(url);
    return Boolean(parsed && parsed.hostname === "chubbyexemplaryhardiness.com" && /^\/get\/2090108(?:\/|$)/i.test(parsed.pathname));
  }

  function isChubbyOnJsUrl(url) {
    const parsed = parseUrl(url);
    return Boolean(parsed && parsed.hostname === "chubbyexemplaryhardiness.com" && parsed.pathname === "/on.js");
  }

  function isWithageConfigUrl(url) {
    const parsed = parseUrl(url);
    return Boolean(parsed && parsed.hostname === "withagecomeswisdom.live" && /^\/api\/ads\/get-info\/v2(?:\/|$)/i.test(parsed.pathname));
  }

  function dispatchRequestBlocked(activeProfile, source, url) {
    window.dispatchEvent(new CustomEvent("site-shield-floater-blocked", {
      detail: {
        profileId: activeProfile.id,
        action: "block",
        source,
        url: String(url || ""),
        host: getUrlHost(url),
        floater: isFloaterUrl(url),
        affiliateHost: isAffiliateNavigationUrl(activeProfile, url),
        chubbyGet: isChubbyGetUrl(url),
        chubbyOnJs: isChubbyOnJsUrl(url),
        withageConfig: isWithageConfigUrl(url),
        frameContext: window.top !== window,
        clickCount: shieldState.clickCount,
        clickSerial: shieldState.clickSerial,
        afterMutationBurst: isAfterMutationBurst(activeProfile)
      }
    }));
  }

  function dispatchDynamicSrcDenied(activeProfile, tag, url, source) {
    window.dispatchEvent(new CustomEvent("site-shield-dynamic-src-blocked", {
      detail: {
        profileId: activeProfile.id,
        action: "block",
        source,
        tag,
        url: String(url || ""),
        host: getUrlHost(url),
        chubbyGet: isChubbyGetUrl(url),
        chubbyOnJs: isChubbyOnJsUrl(url),
        withageConfig: isWithageConfigUrl(url),
        frameContext: window.top !== window,
        pageType: detectPageType(activeProfile)
      }
    }));
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
      const parsed = parseUrl(rawUrl);
      if (!parsed) {
        return false;
      }
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
      const parsed = parseUrl(rawUrl);
      if (!parsed) {
        return false;
      }
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
    parsed = parseUrl(rawUrl);
    if (!parsed) {
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
    const pathname = resolveContextPathname();
    for (const [pageType, rule] of Object.entries(activeProfile.pageTypes || {})) {
      if (!rule || !rule.pathRegex) {
        continue;
      }
      try {
        if (new RegExp(rule.pathRegex, "i").test(pathname)) {
          return pageType;
        }
      } catch (error) {
        return "unknown";
      }
    }
    return "unknown";
  }

  function isChapterContext(activeProfile) {
    return detectPageType(activeProfile) === "chapter";
  }

  function resolveContextHostname() {
    if (location.hostname) {
      return location.hostname;
    }
    for (const candidateWindow of [window.parent, window.top]) {
      try {
        if (candidateWindow && candidateWindow.location && candidateWindow.location.hostname) {
          return candidateWindow.location.hostname;
        }
      } catch (error) {
        continue;
      }
    }
    try {
      return new URL(document.referrer || "").hostname;
    } catch (error) {
      return "";
    }
  }

  function resolveContextPathname() {
    if (location.hostname && location.pathname) {
      return location.pathname;
    }
    for (const candidateWindow of [window.parent, window.top]) {
      try {
        if (candidateWindow && candidateWindow.location && candidateWindow.location.pathname) {
          return candidateWindow.location.pathname;
        }
      } catch (error) {
        continue;
      }
    }
    try {
      return new URL(document.referrer || "").pathname;
    } catch (error) {
      return location.pathname || "";
    }
  }

  function parseUrl(url) {
    try {
      const rawUrl = String(url || "");
      const normalized = rawUrl.startsWith("//") ? "https:" + rawUrl : rawUrl;
      return new URL(normalized, location.href);
    } catch (error) {
      return null;
    }
  }

  function urlHasRedirectTerm(url, terms) {
    const haystack = url.pathname + url.search;
    return (terms || []).some((term) => haystack.toLowerCase().includes(String(term || "").toLowerCase()));
  }
})();
