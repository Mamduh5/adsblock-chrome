(function runSiteShieldContent() {
  "use strict";

  const config = globalThis.SiteShieldConfig;
  const profiles = globalThis.SiteShieldProfiles;
  const heuristics = globalThis.SiteShieldHeuristics;
  const host = location.hostname;
  const DOM_PROCESS_DELAY_MS = 250;
  const MAX_PENDING_ROOTS = 40;
  const MAX_NODES_PER_PASS = 350;
  const MAX_INSPECTION_URLS_PER_PASS = 40;
  const state = {
    enabled: false,
    debug: false,
    inspectionMode: false,
    profile: profiles.findByHostname(host),
    pageType: "unknown",
    pageRules: {},
    customBlockedHosts: [],
    customSelectors: [],
    removedNodes: new WeakSet(),
    neutralizedNodes: new WeakSet(),
    processedNodes: new WeakSet(),
    observedEventKeys: new Set(),
    pendingRoots: new Set(),
    pendingFullScan: false,
    cleanupTimer: null,
    observer: null,
    cleanupQueued: false,
    perfDelta: {
      domPasses: 0,
      skippedDomPasses: 0,
      domNodesProcessed: 0
    },
    perfTimer: null,
    chapterClickCount: 0,
    lastMutationTime: 0,
    pageGuardListenerInstalled: false
  };

  if (state.profile) {
    installPageGuardListener();
  }

  chrome.runtime.sendMessage({ type: "getState", hostname: host }, (response) => {
    if (!response || !response.ok || !response.enabled || !response.profile) {
      return;
    }

    state.enabled = true;
    state.debug = Boolean(response.debug);
    state.inspectionMode = Boolean(response.inspectionMode);
    state.profile = response.profile;
    state.pageType = detectPageType(state.profile);
    state.pageRules = state.profile.pageRules && state.profile.pageRules[state.pageType] || {};
    state.customBlockedHosts = response.settings.customBlockedHosts || [];
    state.customSelectors = response.settings.customSelectors || [];
    startShield();
  });

  function startShield() {
    installPageGuardListener();
    injectPageGuard();
    tryScrubStorage("localStorage");
    tryScrubStorage("sessionStorage");
    installClickInterceptor();
    installMutationObserver();
    queueCleanup(document.documentElement, true);
  }

  function injectPageGuard() {
    // The page guard is registered dynamically with world: "MAIN" at
    // document_start by the service worker. This fallback is intentionally empty;
    // isolated-world injection would be too late and cannot reliably patch page
    // globals such as window.open.
  }

  function installPageGuardListener() {
    if (state.pageGuardListenerInstalled) {
      return;
    }
    state.pageGuardListenerInstalled = true;
    window.addEventListener("site-shield-open-blocked", (event) => {
      incrementStats({ blockedRedirects: 1 });
      recordEvent(config.EVENT_CATEGORIES.OPEN, "window.open blocked", Object.assign({ action: "block" }, event.detail || {}));
      debugLog("window-open-blocked", event.detail || {});
    });
    window.addEventListener("site-shield-click-shielded", (event) => {
      incrementStats({ blockedRedirects: 1 });
      recordEvent(config.EVENT_CATEGORIES.CLICK, "Chapter click shield blocked handler path", Object.assign({
        action: "block",
        pageType: state.pageType
      }, event.detail || {}));
      debugLog("chapter-click-shielded", event.detail || {});
    });
    window.addEventListener("site-shield-location-blocked", (event) => {
      incrementStats({ blockedRedirects: 1 });
      recordEvent(config.EVENT_CATEGORIES.CLICK, "Location redirect blocked during guarded click", Object.assign({
        action: "block",
        pageType: state.pageType
      }, event.detail || {}));
      debugLog("location-blocked", event.detail || {});
    });
    window.addEventListener("site-shield-location-patch-failed", (event) => {
      if (state.inspectionMode) {
        recordEvent(config.EVENT_CATEGORIES.CLICK, "Location patch unavailable", Object.assign({
          action: "observe",
          pageType: state.pageType
        }, event.detail || {}), "location-patch:" + (event.detail && event.detail.source || ""));
      }
    });
    window.addEventListener("site-shield-open-observed", (event) => {
      if (state.inspectionMode) {
        recordEvent(config.EVENT_CATEGORIES.OPEN, "Candidate window.open observed", Object.assign({ action: "observe" }, event.detail || {}), "open:" + (event.detail && event.detail.url || ""));
      }
    });
  }

  function installClickInterceptor() {
    document.addEventListener("click", (event) => {
      if (!state.enabled) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      if (!target) {
        return;
      }

      if (shouldShieldChapterClick(target)) {
        state.chapterClickCount += 1;
        stopEvent(event);
        incrementStats({ blockedRedirects: 1 });
        recordEvent(config.EVENT_CATEGORIES.CLICK, "Chapter capture click shielded", {
          action: "block",
          pageType: state.pageType,
          source: clickActionSource(target),
          clickCount: state.chapterClickCount,
          afterMutationBurst: Date.now() - state.lastMutationTime <= Number(state.pageRules.shieldMutationBurstMs || 1200),
          target: describeNode(target),
          reason: "reader_delegated_click"
        });
        return;
      }

      const actionable = target.closest("a, button, [role='button'], [onclick], [data-href], [data-url]");
      if (!actionable) {
        return;
      }

      const candidateUrl = actionable.getAttribute("href")
        || actionable.getAttribute("data-href")
        || actionable.getAttribute("data-url")
        || "";

      if (state.inspectionMode && candidateUrl && isCandidateUrl(candidateUrl)) {
        recordEvent(config.EVENT_CATEGORIES.CLICK, "Candidate click URL observed", {
          action: "observe",
          url: candidateUrl,
          urlHost: heuristics.getUrlHostname(candidateUrl, location.href),
          text: trimText(actionable.textContent)
        });
      }

      // Capture-phase click defense: block javascript: links, known bad hosts,
      // profile/custom blocked hosts, and redirector URLs with external targets.
      if (heuristics.isSuspiciousUrl(state.profile, candidateUrl, state.customBlockedHosts, location.href) || isChapterJunkUrl(candidateUrl)) {
        stopEvent(event);
        incrementStats({ blockedRedirects: 1 });
        recordEvent(config.EVENT_CATEGORIES.CLICK, "Click navigation blocked", {
          action: "block",
          pageType: state.pageType,
          url: candidateUrl,
          urlHost: heuristics.getUrlHostname(candidateUrl, location.href),
          trigger: isChapterJunkUrl(candidateUrl) ? chapterJunkTrigger(candidateUrl, "") : "url-heuristic",
          text: trimText(actionable.textContent)
        });
        debugLog("click-blocked", { url: candidateUrl, text: actionable.textContent });
        return;
      }

      const overlay = findSuspiciousAncestor(actionable);
      if (overlay && heuristics.textLooksLikeTrap(state.profile, actionable.textContent)) {
        stopEvent(event);
        hideNode(overlay, "trap-click-overlay");
        incrementStats({ blockedRedirects: 1, removedOverlays: 1 });
        recordEvent(config.EVENT_CATEGORIES.CLICK, "Trap overlay click blocked", {
          action: "block",
          node: describeNode(overlay),
          text: trimText(actionable.textContent)
        });
      }
    }, true);
  }

  function installMutationObserver() {
    const root = document.documentElement || document;
    state.observer = new MutationObserver((mutations) => {
      state.lastMutationTime = Date.now();
      let queued = false;
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          for (const node of mutation.addedNodes) {
            if (node instanceof Element) {
              queueCleanup(node, false);
              queued = true;
            }
          }
        } else if (mutation.target instanceof Element) {
          queueCleanup(mutation.target, false);
          queued = true;
        }
      }
      if (!queued && mutations.length) {
        countSkippedDomPass();
      }
    });
    state.observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "id", "src"] });
  }

  function queueCleanup(root, forceFullScan) {
    if (forceFullScan) {
      state.pendingFullScan = true;
      state.pendingRoots.clear();
    } else if (root instanceof Element && !state.pendingFullScan) {
      state.pendingRoots.add(root);
      if (state.pendingRoots.size > MAX_PENDING_ROOTS) {
        state.pendingFullScan = true;
        state.pendingRoots.clear();
      }
    }

    if (state.cleanupTimer) {
      countSkippedDomPass();
      return;
    }

    state.cleanupTimer = setTimeout(() => {
      state.cleanupTimer = null;
      cleanupDom();
    }, DOM_PROCESS_DELAY_MS);
  }

  function cleanupDom() {
    if (!document.documentElement) {
      return;
    }

    const roots = state.pendingFullScan
      ? [document.documentElement]
      : Array.from(state.pendingRoots).filter((root) => root.isConnected);
    state.pendingRoots.clear();
    state.pendingFullScan = false;
    state.perfDelta.domPasses += 1;

    if (!roots.length) {
      flushPerfSoon();
      return;
    }

    let removed = 0;
    removed += removeBySelectors(roots);
    removed += removeSuspiciousIframes(roots);
    removed += removeOverlayCandidates(roots);
    if (state.pageType === "chapter") {
      removed += removeChapterJunk(roots);
      removed += neutralizeChapterClickTraps(roots);
    }
    if (state.inspectionMode) {
      observePageUrls(roots);
    }

    if (removed > 0) {
      document.documentElement.classList.add("site-shield-scroll-unlocked");
      incrementStats({ removedOverlays: removed });
    }
    flushPerfSoon();
  }

  function removeBySelectors(roots) {
    let removed = 0;
    const selectors = (state.profile.hardDomSelectors || state.profile.suspiciousDomSelectors || []).concat(state.customSelectors);

    for (const selector of heuristics.safeSelectorList(selectors)) {
      let nodes = [];
      try {
        nodes = queryWithinRoots(roots, selector, MAX_NODES_PER_PASS);
      } catch (error) {
        debugLog("invalid-selector", { selector });
        continue;
      }

      for (const node of nodes) {
        if (node instanceof HTMLElement && shouldHideSelectorMatch(node)) {
          hideNode(node, "selector:" + selector);
          removed += 1;
        }
      }
    }

    for (const selector of heuristics.safeSelectorList(state.pageRules.hardDomSelectors || [])) {
      let nodes = [];
      try {
        nodes = queryWithinRoots(roots, selector, 80);
      } catch (error) {
        debugLog("invalid-page-selector", { selector });
        continue;
      }

      for (const node of nodes) {
        if (node instanceof HTMLElement && !isProtectedChapterNode(node)) {
          hideNode(node, "chapter-selector:" + selector, {
            pageType: state.pageType,
            selector,
            trigger: "selector"
          });
          removed += 1;
        }
      }
    }

    if (state.inspectionMode) {
      observeCandidateSelectors(roots);
    }

    return removed;
  }

  function observeCandidateSelectors(roots) {
    for (const selector of heuristics.safeSelectorList(state.profile.candidateDomSelectors || [])) {
      let nodes = [];
      try {
        nodes = queryWithinRoots(roots, selector, 12);
      } catch (error) {
        debugLog("invalid-candidate-selector", { selector });
        continue;
      }

      for (const node of nodes) {
        if (node instanceof HTMLElement) {
          recordEvent(config.EVENT_CATEGORIES.DOM, "Candidate selector matched", {
            action: "observe",
            selector,
            node: describeNode(node),
            text: trimText(node.textContent)
          }, "selector:" + selector + ":" + describeNode(node));
        }
      }
    }
  }

  function shouldHideSelectorMatch(node) {
    if (node.tagName === "IFRAME") {
      return true;
    }

    const style = getComputedStyle(node);
    const text = node.textContent || "";
    return isOverlayStyle(node, style) || heuristics.textLooksLikeTrap(state.profile, text);
  }

  function removeSuspiciousIframes(roots) {
    let removed = 0;
    for (const frame of queryWithinRoots(roots, "iframe", MAX_NODES_PER_PASS)) {
      const src = frame.getAttribute("src") || "";
      if (state.inspectionMode && isCandidateUrl(src)) {
        recordEvent(config.EVENT_CATEGORIES.NETWORK, "Candidate iframe host observed", {
          action: "observe",
          url: src,
          urlHost: heuristics.getUrlHostname(src, location.href),
          node: describeNode(frame)
        }, "iframe:" + src);
      }
      if (heuristics.isSuspiciousUrl(state.profile, src, state.customBlockedHosts, location.href)) {
        hideNode(frame, "suspicious-iframe");
        removed += 1;
      }
    }
    return removed;
  }

  function observePageUrls(roots) {
    const nodes = queryWithinRoots(roots, "a[href], iframe[src], script[src], img[src], link[href]", MAX_INSPECTION_URLS_PER_PASS);
    for (const node of nodes) {
      if (state.processedNodes.has(node)) {
        continue;
      }
      state.processedNodes.add(node);
      const url = node.getAttribute("href") || node.getAttribute("src") || "";
      if (!url) {
        continue;
      }
      const urlHost = heuristics.getUrlHostname(url, location.href);
      if (!urlHost) {
        continue;
      }

      if (isCandidateUrl(url)) {
        recordEvent(config.EVENT_CATEGORIES.NETWORK, "Candidate resource URL observed", {
          action: "observe",
          url,
          urlHost,
          node: describeNode(node)
        }, "candidate-url:" + url);
      } else if (heuristics.isSuspiciousUrl(state.profile, url, state.customBlockedHosts, location.href) || isChapterJunkUrl(url)) {
        recordEvent(config.EVENT_CATEGORIES.NETWORK, "Blocking URL heuristic matched", {
          action: "block",
          pageType: state.pageType,
          url,
          urlHost,
          trigger: isChapterJunkUrl(url) ? chapterJunkTrigger(url, "") : "url-heuristic",
          node: describeNode(node)
        }, "block-url:" + url);
      }
    }
  }

  function removeChapterJunk(roots) {
    const rules = state.pageRules || {};
    const maxScans = Number(rules.maxAnchorScansPerPass || 80);
    const anchors = queryWithinRoots(roots, "a[href]", maxScans);
    let removed = 0;

    for (const anchor of anchors) {
      if (!(anchor instanceof HTMLElement) || state.removedNodes.has(anchor) || isProtectedChapterNode(anchor)) {
        continue;
      }

      const href = anchor.getAttribute("href") || "";
      const text = trimText(anchor.textContent);
      const trigger = chapterJunkTrigger(href, text);
      if (!trigger) {
        continue;
      }

      const target = findChapterJunkContainer(anchor);
      if (!target || state.removedNodes.has(target) || isProtectedChapterNode(target)) {
        continue;
      }

      hideNode(target, "chapter-junk:" + trigger, {
        pageType: state.pageType,
        trigger,
        href,
        text,
        container: describeNode(target)
      });
      removed += 1;
    }

    return removed;
  }

  function neutralizeChapterClickTraps(roots) {
    const rules = state.pageRules || {};
    const candidates = collectElements(roots, Number(rules.maxOverlayScansPerPass || 120));
    const readerRects = getReaderRects();
    let neutralized = 0;

    for (const node of candidates) {
      if (!(node instanceof HTMLElement) || state.removedNodes.has(node) || state.neutralizedNodes.has(node)) {
        continue;
      }
      if (isProtectedChapterNode(node) || isChapterOverlayAllowed(node)) {
        continue;
      }
      if (!isPotentialClickSurface(node)) {
        continue;
      }

      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      if (!isSuspiciousChapterOverlay(node, style, rect, readerRects)) {
        continue;
      }

      const href = getClickableUrl(node);
      const host = heuristics.getUrlHostname(href, location.href);
      const trigger = chapterJunkTrigger(href, trimText(node.textContent));
      const reason = trigger
        ? "junk_domain"
        : node.tagName === "A" ? "large_anchor" : "overlay";

      if (trigger || isNearlyInvisible(style, node) || node.tagName === "A") {
        hideNode(node, "chapter-clicktrap:" + reason, chapterOverlayDetails(node, rect, host, reason, trigger));
      } else {
        disableClickSurface(node, reason, rect, host, trigger);
      }
      neutralized += 1;
    }

    return neutralized;
  }

  function isPotentialClickSurface(node) {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    if (node.tagName === "A" && node.getAttribute("href")) {
      return true;
    }
    if (node.hasAttribute("onclick") || node.getAttribute("role") === "button") {
      return true;
    }
    const style = getComputedStyle(node);
    return style.cursor === "pointer" || node.querySelector("a[href]");
  }

  function isSuspiciousChapterOverlay(node, style, rect, readerRects) {
    if (!rect.width || !rect.height) {
      return false;
    }
    if (style.pointerEvents === "none" || style.display === "none" || style.visibility === "hidden") {
      return false;
    }

    const position = style.position;
    const positionedOverlay = position === "fixed" || position === "absolute" || position === "sticky";
    const zIndex = Number.parseInt(style.zIndex, 10);
    const highZ = Number.isFinite(zIndex) && zIndex >= 10;
    const viewportCover = rect.width >= window.innerWidth * Number(state.pageRules.overlayMinViewportWidthRatio || 0.75)
      && rect.height >= window.innerHeight * Number(state.pageRules.overlayMinViewportHeightRatio || 0.4);
    const readerOverlap = overlapsReader(rect, readerRects, Number(state.pageRules.overlayMinReaderOverlapRatio || 0.2));
    const largeAnchor = node.tagName === "A" && rect.width >= window.innerWidth * 0.65 && rect.height >= 160;
    const offsite = isOffsiteClickable(node);

    return (positionedOverlay && (highZ || viewportCover || readerOverlap) && (isNearlyInvisible(style, node) || offsite || largeAnchor))
      || (largeAnchor && (offsite || readerOverlap));
  }

  function getReaderRects() {
    const selectors = state.pageRules.readerSelectors || [];
    const rects = [];
    for (const selector of selectors) {
      try {
        for (const node of document.querySelectorAll(selector)) {
          const rect = node.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            rects.push(rect);
          }
        }
      } catch (error) {
        debugLog("invalid-reader-selector", { selector });
      }
    }

    if (!rects.length) {
      for (const image of document.querySelectorAll("img")) {
        const rect = image.getBoundingClientRect();
        if (rect.width >= 200 && rect.height >= 200) {
          rects.push(rect);
          if (rects.length >= 12) {
            break;
          }
        }
      }
    }
    return rects;
  }

  function overlapsReader(rect, readerRects, minRatio) {
    for (const readerRect of readerRects) {
      const overlapWidth = Math.max(0, Math.min(rect.right, readerRect.right) - Math.max(rect.left, readerRect.left));
      const overlapHeight = Math.max(0, Math.min(rect.bottom, readerRect.bottom) - Math.max(rect.top, readerRect.top));
      const overlapArea = overlapWidth * overlapHeight;
      const readerArea = Math.max(1, readerRect.width * readerRect.height);
      if (overlapArea / readerArea >= minRatio) {
        return true;
      }
    }
    return false;
  }

  function isNearlyInvisible(style, node) {
    const opacity = Number.parseFloat(style.opacity);
    const transparentOpacity = Number.isFinite(opacity) && opacity <= Number(state.pageRules.overlayNearTransparentOpacity || 0.15);
    const noText = trimText(node.textContent).length <= 4;
    const transparentBg = /rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)|transparent/i.test(style.backgroundColor || "");
    return transparentOpacity || (noText && transparentBg);
  }

  function isOffsiteClickable(node) {
    const url = getClickableUrl(node);
    if (!url) {
      return false;
    }
    const urlHost = heuristics.getUrlHostname(url, location.href);
    return Boolean(urlHost && !profiles.profileMatchesHostname(state.profile, urlHost));
  }

  function getClickableUrl(node) {
    const link = node.closest("a[href]") || node.querySelector && node.querySelector("a[href]");
    return link ? link.getAttribute("href") || "" : node.getAttribute("href") || node.getAttribute("data-href") || node.getAttribute("data-url") || "";
  }

  function disableClickSurface(node, reason, rect, host, trigger) {
    state.neutralizedNodes.add(node);
    node.style.setProperty("pointer-events", "none", "important");
    node.removeAttribute("onclick");
    node.setAttribute("data-site-shield-neutralized", "true");
    recordEvent(config.EVENT_CATEGORIES.DOM, "Chapter click surface neutralized", chapterOverlayDetails(node, rect, host, reason, trigger));
  }

  function chapterOverlayDetails(node, rect, host, reason, trigger) {
    return {
      action: "block",
      pageType: state.pageType,
      reason,
      trigger,
      tag: node.tagName.toLowerCase(),
      node: describeNode(node),
      host: host || "",
      rect: rectSummary(rect)
    };
  }

  function rectSummary(rect) {
    return [
      Math.round(rect.left),
      Math.round(rect.top),
      Math.round(rect.width),
      Math.round(rect.height)
    ].join(",");
  }

  function chapterJunkTrigger(href, text) {
    const rules = state.pageRules || {};
    const urlHost = heuristics.getUrlHostname(href, location.href);
    const haystack = (href + " " + text).toLowerCase();

    for (const junkHost of rules.hardBlockHosts || []) {
      if (urlHost && heuristics.isSubdomainOrSame(urlHost, junkHost)) {
        return "host:" + junkHost;
      }
      if (haystack.includes(String(junkHost).toLowerCase())) {
        return "text:" + junkHost;
      }
    }

    for (const keyword of rules.hardHostKeywords || []) {
      if (haystack.includes(String(keyword).toLowerCase())) {
        return "keyword:" + keyword;
      }
    }

    for (const term of rules.junkTextTerms || []) {
      if (haystack.includes(String(term).toLowerCase())) {
        return "term:" + term;
      }
    }

    return "";
  }

  function findChapterJunkContainer(anchor) {
    let current = anchor;
    let depth = 0;
    while (current && current instanceof HTMLElement && current !== document.body && depth < 4) {
      if (isProtectedChapterNode(current)) {
        return anchor;
      }

      if (isSafeChapterRemovalContainer(current)) {
        return current;
      }

      current = current.parentElement;
      depth += 1;
    }
    return anchor;
  }

  function isSafeChapterRemovalContainer(node) {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    if (node.querySelector("img, picture, canvas, video")) {
      return false;
    }
    if (node.querySelector("select, option, input, textarea, form")) {
      return false;
    }

    const tag = node.tagName.toLowerCase();
    const allowed = state.pageRules.removalContainerSelectors || ["a", "span", "p", "li", "div"];
    if (!allowed.includes(tag) && !allowed.some((selector) => selector.startsWith(".") && node.matches(selector))) {
      return false;
    }

    const text = trimText(node.textContent);
    const anchorCount = node.querySelectorAll("a[href]").length;
    return text.length <= 500 && anchorCount <= 12;
  }

  function isProtectedChapterNode(node) {
    if (state.pageType !== "chapter" || !(node instanceof Element)) {
      return false;
    }
    if (node.closest("img, picture, select, option, form, input, textarea")) {
      return true;
    }
    for (const selector of state.pageRules.protectedSelectors || []) {
      try {
        if (node.closest(selector)) {
          return true;
        }
      } catch (error) {
        debugLog("invalid-protected-selector", { selector });
      }
    }
    const href = node instanceof HTMLAnchorElement ? node.getAttribute("href") || "" : "";
    return /\/manga\/[^/]+\/chapter-/i.test(href);
  }

  function isChapterOverlayAllowed(node) {
    for (const selector of state.pageRules.overlayAllowSelectors || []) {
      try {
        if (node.closest(selector)) {
          return true;
        }
      } catch (error) {
        debugLog("invalid-overlay-allow-selector", { selector });
      }
    }
    return false;
  }

  function shouldShieldChapterClick(target) {
    if (state.pageType !== "chapter" || !state.pageRules.clickShieldEnabled) {
      return false;
    }
    if (isProtectedChapterNode(target) || isChapterOverlayAllowed(target)) {
      return false;
    }

    const actionable = target.closest("a[href], button, [role='button'], [onclick], [data-href], [data-url]");
    if (actionable) {
      const url = actionable.getAttribute("href") || actionable.getAttribute("data-href") || actionable.getAttribute("data-url") || "";
      if (!url) {
        return false;
      }
      const urlHost = heuristics.getUrlHostname(url, location.href);
      return Boolean(urlHost && !profiles.profileMatchesHostname(state.profile, urlHost)) || isChapterJunkUrl(url);
    }

    return Boolean(state.pageRules.shieldPlainReaderClicks && isInsideChapterReader(target));
  }

  function isInsideChapterReader(target) {
    for (const selector of state.pageRules.readerSelectors || []) {
      try {
        if (target.closest(selector)) {
          return true;
        }
      } catch (error) {
        debugLog("invalid-reader-selector", { selector });
      }
    }
    return target.tagName === "IMG";
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

  function removeOverlayCandidates(roots) {
    let removed = 0;
    const candidates = collectElements(roots, MAX_NODES_PER_PASS);

    for (const node of candidates) {
      if (!(node instanceof HTMLElement) || state.removedNodes.has(node)) {
        continue;
      }

      const style = getComputedStyle(node);
      if (!isOverlayStyle(node, style)) {
        continue;
      }

      const text = node.textContent || "";
      const hasTrapText = heuristics.textLooksLikeTrap(state.profile, text);
      const hasSuspiciousClass = heuristics.domNameLooksSuspicious(state.profile, node.id + " " + node.className);
      const hasBadFrame = Boolean(node.querySelector("iframe[src]"));

      // Overlay detection stays conservative: fixed/sticky, large, clickable,
      // high z-index elements need ad/trap signals before being removed.
      if (hasTrapText || hasSuspiciousClass || hasBadFrame) {
        hideNode(node, "overlay-heuristic");
        removed += 1;
      } else if (state.inspectionMode) {
        recordEvent(config.EVENT_CATEGORIES.DOM, "Overlay-shaped node observed", {
          action: "observe",
          node: describeNode(node),
          zIndex: style.zIndex,
          text: trimText(text)
        }, "overlay:" + describeNode(node));
      }
    }

    return removed;
  }

  function isOverlayStyle(node, style) {
    const position = style.position;
    if (position !== "fixed" && position !== "sticky") {
      return false;
    }

    const tuning = state.profile.tuning || {};
    const zIndex = Number.parseInt(style.zIndex, 10);
    if (!Number.isFinite(zIndex) || zIndex < Number(tuning.overlayMinZIndex || 1000)) {
      return false;
    }

    if (style.pointerEvents === "none" || style.display === "none" || style.visibility === "hidden") {
      return false;
    }

    const rect = node.getBoundingClientRect();
    const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    return area / viewportArea >= Number(tuning.overlayMinViewportAreaRatio || 0.35)
      || (rect.width >= window.innerWidth * Number(tuning.overlayWideWidthRatio || 0.85)
        && rect.height >= Number(tuning.overlayWideMinHeight || 120));
  }

  function queryWithinRoots(roots, selector, limit) {
    const results = [];
    const seen = new WeakSet();
    for (const root of roots) {
      if (!(root instanceof Element) || !root.isConnected) {
        continue;
      }
      try {
        if (root.matches(selector) && !seen.has(root)) {
          seen.add(root);
          results.push(root);
        }
      } catch (error) {
        throw error;
      }

      for (const node of root.querySelectorAll(selector)) {
        if (!seen.has(node)) {
          seen.add(node);
          results.push(node);
          if (results.length >= limit) {
            state.perfDelta.domNodesProcessed += results.length;
            return results;
          }
        }
      }
    }
    state.perfDelta.domNodesProcessed += results.length;
    return results;
  }

  function collectElements(roots, limit) {
    const results = [];
    const seen = new WeakSet();
    for (const root of roots) {
      if (!(root instanceof Element) || !root.isConnected) {
        continue;
      }
      if (!seen.has(root)) {
        seen.add(root);
        results.push(root);
      }
      for (const node of root.querySelectorAll("*")) {
        if (!seen.has(node)) {
          seen.add(node);
          results.push(node);
          if (results.length >= limit) {
            state.perfDelta.domNodesProcessed += results.length;
            return results;
          }
        }
      }
    }
    state.perfDelta.domNodesProcessed += results.length;
    return results;
  }

  function countSkippedDomPass() {
    state.perfDelta.skippedDomPasses += 1;
  }

  function flushPerfSoon() {
    if (state.perfTimer) {
      return;
    }
    state.perfTimer = setTimeout(() => {
      state.perfTimer = null;
      const delta = state.perfDelta;
      state.perfDelta = {
        domPasses: 0,
        skippedDomPasses: 0,
        domNodesProcessed: 0
      };
      if (delta.domPasses || delta.skippedDomPasses || delta.domNodesProcessed) {
        chrome.runtime.sendMessage({ type: "recordPerf", profileId: state.profile.id, delta });
      }
    }, 3000);
  }

  function findSuspiciousAncestor(node) {
    let current = node instanceof Element ? node : null;
    while (current && current !== document.documentElement) {
      if (current instanceof HTMLElement && isOverlayStyle(current, getComputedStyle(current))) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function hideNode(node, reason, extraDetails) {
    if (state.removedNodes.has(node)) {
      return;
    }
    state.removedNodes.add(node);
    node.setAttribute("data-site-shield-hidden", "true");
    node.setAttribute("aria-hidden", "true");
    recordEvent(config.EVENT_CATEGORIES.DOM, "DOM node hidden", {
      action: "block",
      reason,
      pageType: state.pageType,
      node: describeNode(node),
      ...(extraDetails || {})
    });
    debugLog("node-hidden", { reason, node: describeNode(node) });
  }

  function tryScrubStorage(label) {
    try {
      scrubStorage(window[label], label);
    } catch (error) {
      debugLog("storage-unavailable", { label, error: String(error) });
    }
  }

  function scrubStorage(storageArea, label) {
    let deleted = 0;
    const keys = [];
    try {
      for (let index = 0; index < storageArea.length; index += 1) {
        keys.push(storageArea.key(index));
      }
    } catch (error) {
      debugLog("storage-read-failed", { label, error: String(error) });
      return;
    }

    for (const key of keys) {
      if (!key) {
        continue;
      }

      if (state.inspectionMode && heuristics.isCandidateStorageKey(state.profile, key)) {
        recordEvent(config.EVENT_CATEGORIES.STORAGE, "Candidate storage key observed", {
          action: "observe",
          area: label,
          key
        }, "storage:" + label + ":" + key);
        continue;
      }

      if (!heuristics.shouldScrubStorageKey(state.profile, key)) {
        continue;
      }

      // Selective storage cleanup removes only profile-defined suspicious keys.
      // It intentionally does not clear the full storage area.
      try {
        storageArea.removeItem(key);
        deleted += 1;
        recordEvent(config.EVENT_CATEGORIES.STORAGE, "Storage key removed", { action: "block", area: label, key });
        debugLog("storage-key-deleted", { label, key });
      } catch (error) {
        debugLog("storage-delete-failed", { label, key, error: String(error) });
      }
    }

    if (deleted > 0) {
      incrementStats({ deletedStorageItems: deleted });
    }
  }

  function stopEvent(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
  }

  function incrementStats(delta) {
    chrome.runtime.sendMessage({ type: "incrementStats", profileId: state.profile.id, hostname: host, delta });
  }

  function recordEvent(category, summary, details, dedupeKey) {
    if (dedupeKey) {
      if (state.observedEventKeys.has(dedupeKey)) {
        return;
      }
      state.observedEventKeys.add(dedupeKey);
    }
    chrome.runtime.sendMessage({
      type: "recordEvent",
      profileId: state.profile.id,
      hostname: host,
      category,
      summary,
      details,
      pageUrl: location.href
    });
  }

  function debugLog(eventName, details) {
    if (state.debug) {
      console.info("[Site Shield]", eventName, details);
    }
  }

  function describeNode(node) {
    const id = node.id ? "#" + node.id : "";
    const className = typeof node.className === "string" && node.className ? "." + node.className.trim().replace(/\s+/g, ".") : "";
    return node.tagName.toLowerCase() + id + className;
  }

  function trimText(text) {
    return String(text || "").replace(/\s+/g, " ").trim().slice(0, 120);
  }

  function isCandidateUrl(url) {
    const host = heuristics.getUrlHostname(url, location.href);
    return host && heuristics.isCandidateHost(state.profile, host);
  }

  function isChapterJunkUrl(url) {
    return state.pageType === "chapter" && Boolean(chapterJunkTrigger(url, ""));
  }

  function detectPageType(profile) {
    const pageTypes = profile && profile.pageTypes || {};
    for (const [pageType, rule] of Object.entries(pageTypes)) {
      if (!rule || !rule.pathRegex) {
        continue;
      }
      try {
        if (new RegExp(rule.pathRegex, "i").test(location.pathname)) {
          return pageType;
        }
      } catch (error) {
        debugLog("invalid-page-type-regex", { pageType, pattern: rule.pathRegex });
      }
    }
    return "unknown";
  }
})();
