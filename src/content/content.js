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
    popupCheckTimer: null,
    observer: null,
    cleanupQueued: false,
    readerCacheAt: 0,
    readerRootsCache: [],
    readerRectsCache: [],
    perfDelta: {
      domPasses: 0,
      skippedDomPasses: 0,
      domNodesProcessed: 0,
      clicksShielded: 0,
      opensBlocked: 0,
      duplicateOpenAttemptsBlocked: 0,
      orphanJunkRemoved: 0,
      footerJunkGroupsRemoved: 0,
      popupLayersRemoved: 0,
      popupLayersReremoved: 0,
      popupCardsMatched: 0,
      popupBackdropsNeutralized: 0,
      imageBlockPopupRemoved: 0,
      fullscreenOverlayRemoved: 0,
      xmlOherbutthedsBlocked: 0,
      brokenIframeRemoved: 0,
      orphanAdUiRemoved: 0,
      orphanXRemoved: 0,
      blockedAdBootstrapScripts: 0,
      blockedFirstPartyAdLoader: 0,
      fixedPopupIframeRemoved: 0,
      adContainerRemoved: 0,
      readerInjectedAdBlockRemoved: 0,
      hiddenOnlyFallbackCount: 0,
      rearmedHijackAttemptsBlocked: 0,
      expensiveScansSkipped: 0
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
    installChapterRearmWatchers();
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
      addPerfDelta({
        opensBlocked: 1,
        duplicateOpenAttemptsBlocked: event.detail && event.detail.duplicateAttempt ? 1 : 0,
        rearmedHijackAttemptsBlocked: event.detail && event.detail.afterMutationBurst ? 1 : 0
      });
      recordEvent(config.EVENT_CATEGORIES.OPEN, "window.open blocked", Object.assign({ action: "block" }, event.detail || {}));
      debugLog("window-open-blocked", event.detail || {});
    });
    window.addEventListener("site-shield-click-shielded", (event) => {
      incrementStats({ blockedRedirects: 1 });
      addPerfDelta({
        clicksShielded: 1,
        rearmedHijackAttemptsBlocked: event.detail && event.detail.afterMutationBurst ? 1 : 0
      });
      recordEvent(config.EVENT_CATEGORIES.CLICK, "Chapter click shield blocked handler path", Object.assign({
        action: "block",
        pageType: state.pageType
      }, event.detail || {}));
      debugLog("chapter-click-shielded", event.detail || {});
    });
    window.addEventListener("site-shield-location-blocked", (event) => {
      incrementStats({ blockedRedirects: 1 });
      addPerfDelta({
        opensBlocked: 1,
        duplicateOpenAttemptsBlocked: event.detail && event.detail.duplicateAttempt ? 1 : 0,
        rearmedHijackAttemptsBlocked: event.detail && event.detail.afterMutationBurst ? 1 : 0
      });
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
        const safeLink = getSafeChapterLink(target);
        state.chapterClickCount += 1;
        stopEvent(event);
        incrementStats({ blockedRedirects: 1 });
        addPerfDelta({ clicksShielded: 1 });
        recordEvent(config.EVENT_CATEGORIES.CLICK, "Chapter capture click shielded", {
          action: safeLink ? "allow_safe_navigate" : "block",
          pageType: state.pageType,
          source: safeLink ? "anchor_first_party" : clickActionSource(target),
          clickCount: state.chapterClickCount,
          afterMutationBurst: Date.now() - state.lastMutationTime <= Number(state.pageRules.shieldMutationBurstMs || 1200),
          url: safeLink || "",
          target: describeNode(target),
          reason: safeLink ? "first_party_link" : "chapter_click_shield"
        });
        if (safeLink) {
          window.setTimeout(() => {
            location.assign(safeLink);
          }, 0);
        }
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
            if (node instanceof Element && isRelevantMutationNode(node)) {
              queueCleanup(node, false);
              queued = true;
            }
          }
        } else if (mutation.target instanceof Element) {
          if (isRelevantMutationNode(mutation.target)) {
            queueCleanup(mutation.target, false);
            queued = true;
          }
        }
      }
      if (!queued && mutations.length) {
        countSkippedDomPass();
      }
    });
    state.observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "id", "src"] });
  }

  function installChapterRearmWatchers() {
    if (state.pageType !== "chapter") {
      return;
    }
    window.addEventListener("scroll", schedulePopupLayerCheck, { passive: true });
    window.setTimeout(schedulePopupLayerCheck, 1200);
    window.setTimeout(schedulePopupLayerCheck, 3500);
  }

  function schedulePopupLayerCheck() {
    if (state.popupCheckTimer || state.pageType !== "chapter") {
      return;
    }
    state.popupCheckTimer = window.setTimeout(() => {
      state.popupCheckTimer = null;
      const removed = removeChapterPopupLayers([document.documentElement]);
      if (removed > 0) {
        document.documentElement.classList.add("site-shield-scroll-unlocked");
        incrementStats({ removedOverlays: removed });
      }
      flushPerfSoon();
    }, 1500);
  }

  function isRelevantMutationNode(node) {
    if (state.pageType !== "chapter") {
      return true;
    }
    if (!(node instanceof Element)) {
      return false;
    }
    if (looksRelevantChapterNode(node)) {
      return true;
    }
    countSkippedDomPass();
    return false;
  }

  function looksRelevantChapterNode(node) {
    const name = String(node.id || "") + " " + String(node.className || "");
    if (/ad|ads|advert|sponsor|popup|modal|overlay|backdrop|notification|notify|content-notification|footer|bottom/i.test(name)) {
      return true;
    }
    const selector = [
      "a[href]",
      "iframe[src]",
      "[onclick]",
      "[role='dialog']",
      "[aria-modal='true']",
      "[class*='notification' i]",
      "[id*='notification' i]",
      "[class*='overlay' i]",
      "[id*='overlay' i]",
      "a.image_block",
      "img.kjalsgsdd",
      ".cbtoa",
      "._0f84a320",
      ".ads-contain",
      ".banner-cus",
      ".banner-v2",
      ".banner-container",
      ".ads-banner",
      "script[src]",
      "iframe[src^='undefined/iframe' i]",
      "iframe[src*='pid=undefined' i]",
      "[style*='linear-gradient' i]",
      "[style*='flex-direction: column' i]",
      "[style*='border-radius: 16px' i]",
      "[style*='border-radius:16px' i]"
    ].join(",");
    try {
      return node.matches(selector) || Boolean(node.querySelector(selector));
    } catch (error) {
      return false;
    }
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
    if (state.pageType === "chapter") {
      removed += removeKnownChapterAdScripts(roots);
      removed += removeExactChapterPopupFamily(roots);
      removed += removeStableChapterAdContainers(roots);
      removed += removeReaderInjectedAdBlocks(roots);
    }
    removed += removeBySelectors(roots);
    removed += removeSuspiciousIframes(roots);
    removed += removeOverlayCandidates(roots);
    if (state.pageType === "chapter") {
      removed += removeChapterPopupLayers(roots);
      removed += removeChapterJunk(roots);
      removed += neutralizeChapterClickTraps(roots);
      removed += removeChapterOrphanJunk(roots);
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

  function removeKnownChapterAdScripts(roots) {
    const scripts = queryWithinRoots(roots, "script[src]", 60);
    let removed = 0;
    let firstParty = 0;
    for (const script of scripts) {
      if (!(script instanceof HTMLScriptElement) || state.removedNodes.has(script)) {
        continue;
      }
      const src = script.getAttribute("src") || "";
      const reason = knownChapterAdScriptReason(src);
      if (!reason) {
        continue;
      }
      removeNode(script, "chapter-ad-bootstrap-script", {
        action: "block",
        pageType: state.pageType,
        src,
        reason
      });
      removed += 1;
      firstParty += reason === "first_party_ad_loader" ? 1 : 0;
    }
    if (removed > 0) {
      addPerfDelta({
        blockedAdBootstrapScripts: removed - firstParty,
        blockedFirstPartyAdLoader: firstParty
      });
    }
    return removed;
  }

  function knownChapterAdScriptReason(src) {
    let parsed;
    try {
      parsed = new URL(String(src || ""), location.href);
    } catch (error) {
      return "";
    }
    for (const exactUrl of state.pageRules.adBootstrapScriptUrls || []) {
      try {
        const expected = new URL(exactUrl);
        if (parsed.hostname === expected.hostname && parsed.pathname === expected.pathname) {
          return "third_party_ad_bootstrap";
        }
      } catch (error) {
        debugLog("invalid-ad-script-url", { exactUrl });
      }
    }
    if (profiles.profileMatchesHostname(state.profile, parsed.hostname)) {
      for (const path of state.pageRules.firstPartyAdScriptPaths || []) {
        if (parsed.pathname === path) {
          return "first_party_ad_loader";
        }
      }
    }
    return "";
  }

  function removeStableChapterAdContainers(roots) {
    const selector = heuristics.safeSelectorList(state.pageRules.adContainerSelectors || []).join(",");
    if (!selector) {
      return 0;
    }
    let removed = 0;
    for (const node of queryWithinRoots(roots, selector, 80)) {
      if (!(node instanceof HTMLElement) || state.removedNodes.has(node) || isProtectedChapterNode(node) || isReaderRoot(node)) {
        continue;
      }
      removeNode(node, "chapter-stable-ad-container", {
        action: "block",
        pageType: state.pageType,
        node: describeNode(node),
        text: trimText(node.textContent)
      });
      removed += 1;
    }
    if (removed > 0) {
      addPerfDelta({ adContainerRemoved: removed });
    }
    return removed;
  }

  function removeReaderInjectedAdBlocks(roots) {
    const selector = heuristics.safeSelectorList(state.pageRules.readerInjectedAdSelectors || []).join(",");
    if (!selector) {
      return 0;
    }
    let removed = 0;
    for (const node of queryWithinRoots(roots, selector, 80)) {
      if (!(node instanceof HTMLElement) || state.removedNodes.has(node) || !isInsideChapterReader(node) || isProtectedChapterNode(node)) {
        continue;
      }
      const target = readerInjectedAdRemovalTarget(node);
      if (!target || state.removedNodes.has(target) || isReaderRoot(target) || isProtectedChapterNode(target)) {
        continue;
      }
      removeNode(target, "chapter-reader-injected-ad", {
        action: "block",
        pageType: state.pageType,
        node: describeNode(target),
        trigger: describeNode(node)
      });
      removed += 1;
    }
    if (removed > 0) {
      addPerfDelta({ readerInjectedAdBlockRemoved: removed });
    }
    return removed;
  }

  function readerInjectedAdRemovalTarget(node) {
    if (node.tagName === "SCRIPT" || node.tagName === "IFRAME") {
      const parent = node.parentElement;
      if (parent instanceof HTMLElement && parent !== document.body && !parent.querySelector("img, picture") && parent.textContent.length <= 300) {
        return parent;
      }
      return node;
    }
    return node;
  }

  function isReaderRoot(node) {
    for (const selector of state.pageRules.readerSelectors || []) {
      try {
        if (node.matches(selector)) {
          return true;
        }
      } catch (error) {
        debugLog("invalid-reader-selector", { selector });
      }
    }
    return false;
  }

  function removeSuspiciousIframes(roots) {
    let removed = 0;
    for (const frame of queryWithinRoots(roots, "iframe", MAX_NODES_PER_PASS)) {
      const src = frame.getAttribute("src") || "";
      if (state.pageType === "chapter" && isBrokenChapterIframe(frame)) {
        removeNode(frame, "chapter-broken-iframe", {
          action: "block",
          pageType: state.pageType,
          src,
          node: describeNode(frame)
        });
        removed += 1;
        addPerfDelta({ brokenIframeRemoved: 1 });
        continue;
      }
      if (state.pageType === "chapter" && isFixedCenteredPopupIframe(frame)) {
        const target = fixedPopupIframeRemovalTarget(frame);
        removeNode(target, "chapter-fixed-popup-iframe", {
          action: "block",
          pageType: state.pageType,
          src,
          node: describeNode(target),
          iframe: describeNode(frame)
        });
        removed += 1;
        addPerfDelta({ fixedPopupIframeRemoved: 1 });
        removed += removeExactFullscreenOverlays([document.documentElement], frame);
        continue;
      }
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

  function isFixedCenteredPopupIframe(frame) {
    const sandbox = frame.getAttribute("sandbox") || "";
    if (!/\ballow-popups\b/i.test(sandbox)) {
      return false;
    }
    const style = getComputedStyle(frame);
    const zIndex = Number.parseInt(style.zIndex, 10);
    return style.position === "fixed"
      && nearCssPercent(frame.style.top || style.top, 50)
      && nearCssPercent(frame.style.left || style.left, 50)
      && /translate\(\s*-50%\s*,\s*-50%\s*\)/i.test(style.transform || frame.getAttribute("style") || "")
      && Number.isFinite(zIndex)
      && zIndex >= 2147483647;
  }

  function nearCssPercent(value, expected) {
    return Math.abs(Number.parseFloat(String(value || "")) - expected) <= 1 && String(value || "").includes("%");
  }

  function fixedPopupIframeRemovalTarget(frame) {
    let current = frame;
    let best = frame;
    let depth = 0;
    while (current instanceof HTMLElement && current !== document.body && depth < 3) {
      if (isProtectedChapterNode(current) || isReaderRoot(current)) {
        return best;
      }
      const style = getComputedStyle(current);
      const zIndex = Number.parseInt(style.zIndex, 10);
      if ((style.position === "fixed" || style.position === "absolute" || style.position === "relative") && Number.isFinite(zIndex) && zIndex >= 1000) {
        best = current;
      }
      current = current.parentElement;
      depth += 1;
    }
    return best;
  }

  function isBrokenChapterIframe(frame) {
    const src = String(frame.getAttribute("src") || "");
    if (!/^undefined\/iframe/i.test(src) && !(src.includes("pbjs=1") && src.includes("pid=undefined"))) {
      return false;
    }
    const style = getComputedStyle(frame);
    const rect = frame.getBoundingClientRect();
    return style.display === "none" || (rect.width <= 1 && rect.height <= 1) || /height\s*:\s*0px/i.test(frame.getAttribute("style") || "");
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
    const anchors = uniqueElements(
      queryWithinRoots(roots, chapterJunkAnchorSelector(rules), maxScans)
        .concat(queryWithinRoots(roots, "a[href]", maxScans))
    );
    let removed = 0;
    let footerRemoved = 0;

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
      if (isFooterJunkNode(target)) {
        footerRemoved += 1;
      }
    }

    if (footerRemoved > 0) {
      addPerfDelta({ footerJunkGroupsRemoved: footerRemoved });
    }
    return removed;
  }

  function chapterJunkAnchorSelector(rules) {
    const selectors = [];
    for (const hostName of rules.hardBlockHosts || []) {
      selectors.push("a[href*='" + cssString(hostName) + "' i]");
    }
    for (const keyword of rules.hardHostKeywords || []) {
      selectors.push("a[href*='" + cssString(keyword) + "' i]");
    }
    return selectors.length ? selectors.join(",") : "a[href]";
  }

  function cssString(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  function uniqueElements(nodes) {
    const seen = new WeakSet();
    const results = [];
    for (const node of nodes) {
      if (node instanceof Element && !seen.has(node)) {
        seen.add(node);
        results.push(node);
      }
    }
    return results;
  }

  function removeExactChapterPopupFamily(roots) {
    const rules = state.pageRules || {};
    const scanRoots = uniqueElements(roots.concat([document.documentElement]));
    const popupSelector = heuristics.safeSelectorList(rules.exactPopupSelectors || []).join(",");
    const overlaySelector = heuristics.safeSelectorList(rules.exactFullscreenOverlaySelectors || []).join(",");
    const iframeSelector = heuristics.safeSelectorList(rules.brokenIframeSelectors || []).join(",");
    let removed = 0;
    let imageBlockRemoved = 0;
    let overlayRemoved = 0;
    let xmlBlocked = 0;
    let brokenIframeRemoved = 0;

    if (popupSelector) {
      for (const node of queryWithinRoots(scanRoots, popupSelector, 30)) {
        if (!(node instanceof HTMLElement) || state.removedNodes.has(node)) {
          continue;
        }
        const anchor = exactImageBlockAnchor(node);
        if (!anchor || state.removedNodes.has(anchor)) {
          continue;
        }
        const target = findExactImageBlockContainer(anchor);
        removeNode(target, "exact-image-block-popup", exactPopupDetails(target, anchor, "image_block"));
        removed += 1;
        imageBlockRemoved += 1;
        xmlBlocked += 1;
        removed += removeExactPopupOrphans(target);
        const backdrops = removeExactFullscreenOverlays(scanRoots, anchor);
        removed += backdrops;
        overlayRemoved += backdrops;
      }
    }

    if (overlaySelector) {
      const overlays = removeExactFullscreenOverlays(scanRoots, null);
      removed += overlays;
      overlayRemoved += overlays;
    }

    if (iframeSelector) {
      for (const frame of queryWithinRoots(scanRoots, iframeSelector, 20)) {
        if (frame instanceof HTMLIFrameElement && !state.removedNodes.has(frame) && isBrokenChapterIframe(frame)) {
          removeNode(frame, "exact-broken-iframe", {
            action: "block",
            pageType: state.pageType,
            src: frame.getAttribute("src") || "",
            node: describeNode(frame)
          });
          removed += 1;
          brokenIframeRemoved += 1;
        }
      }
    }

    if (removed > 0) {
      addPerfDelta({
        imageBlockPopupRemoved: imageBlockRemoved,
        fullscreenOverlayRemoved: overlayRemoved,
        xmlOherbutthedsBlocked: xmlBlocked,
        brokenIframeRemoved,
        orphanAdUiRemoved: Math.max(0, removed - imageBlockRemoved - overlayRemoved - brokenIframeRemoved)
      });
    }
    return removed;
  }

  function exactImageBlockAnchor(node) {
    const anchor = node instanceof HTMLAnchorElement ? node : node.closest && node.closest("a.image_block[href]");
    if (!(anchor instanceof HTMLAnchorElement)) {
      return null;
    }
    const href = anchor.getAttribute("href") || "";
    if (!/xml\.oherbuttheds\.com\/click/i.test(href)) {
      return null;
    }
    if (anchor.getAttribute("target") !== "_blank") {
      return null;
    }
    if (!anchor.querySelector("img[src*='xml.oherbuttheds.com/thumbnail' i], .cbtoa") && !/click here/i.test(anchor.textContent || "")) {
      return null;
    }
    return anchor;
  }

  function findExactImageBlockContainer(anchor) {
    let current = anchor;
    let best = anchor;
    let depth = 0;
    while (current instanceof HTMLElement && current !== document.body && depth < 4) {
      if (isExactPopupWrapper(current)) {
        best = current;
      }
      current = current.parentElement;
      depth += 1;
    }
    return best;
  }

  function isExactPopupWrapper(node) {
    if (node === document.documentElement || node === document.body) {
      return false;
    }
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.width > window.innerWidth || rect.height > window.innerHeight * 0.95) {
      return false;
    }
    const text = trimText(node.textContent);
    return node.matches("a.image_block")
      || node.querySelector("a.image_block[href*='xml.oherbuttheds.com/click' i]")
      || (/click here/i.test(text) && (style.position === "fixed" || style.position === "absolute" || style.position === "relative"));
  }

  function removeExactFullscreenOverlays(roots, triggerNode) {
    const selector = heuristics.safeSelectorList(state.pageRules.exactFullscreenOverlaySelectors || []).join(",");
    if (!selector) {
      return 0;
    }
    let removed = 0;
    for (const node of queryWithinRoots(roots, selector, 30)) {
      if (!(node instanceof HTMLElement) || state.removedNodes.has(node) || node === triggerNode || triggerNode && triggerNode.contains(node)) {
        continue;
      }
      if (!isExactFullscreenClickCatcher(node)) {
        continue;
      }
      removeNode(node, "exact-fullscreen-click-catcher", exactPopupDetails(node, triggerNode || node, "fullscreen_overlay"));
      removed += 1;
    }
    return removed;
  }

  function isExactFullscreenClickCatcher(node) {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    const zIndex = Number.parseInt(style.zIndex, 10);
    const coversViewport = rect.left <= 2
      && rect.top <= 2
      && rect.width >= window.innerWidth * 0.95
      && rect.height >= window.innerHeight * 0.95;
    return style.position === "fixed"
      && coversViewport
      && Number.isFinite(zIndex)
      && zIndex >= 2147483646
      && style.pointerEvents === "auto"
      && /rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*(0\.[3-9]|1|50%)/i.test(style.backgroundColor || "");
  }

  function removeExactPopupOrphans(target) {
    let removed = 0;
    const roots = uniqueElements([target.parentElement, document.documentElement].filter(Boolean));
    for (const node of queryWithinRoots(roots, ".cbtoa, [class*='advertisement' i], [id*='advertisement' i], [class*='ad-label' i]", 25)) {
      if (!(node instanceof HTMLElement) || state.removedNodes.has(node) || target.contains(node)) {
        continue;
      }
      if (!shouldRemoveOrphanJunkNode(node)) {
        continue;
      }
      removeNode(node, "exact-popup-orphan-ui", orphanDetails(node, "exact", "image_block"));
      removed += 1;
    }
    return removed;
  }

  function exactPopupDetails(node, triggerNode, signal) {
    return {
      action: "block",
      pageType: state.pageType,
      signal,
      node: describeNode(node),
      trigger: triggerNode ? describeNode(triggerNode) : "",
      href: triggerNode && triggerNode.getAttribute ? triggerNode.getAttribute("href") || "" : "",
      rect: rectSummary(node.getBoundingClientRect())
    };
  }

  function removeChapterPopupLayers(roots) {
    const rules = state.pageRules || {};
    const limit = Number(rules.maxPopupScansPerPass || 40);
    const selector = popupLayerSelector(rules);
    const candidates = uniqueElements(
      queryWithinRoots(roots, selector, limit)
        .concat(queryWithinRoots(roots, "button, a, [role='button']", Math.min(20, limit)))
    );
    let removed = 0;
    let reremoved = 0;
    let cardsMatched = 0;
    let backdropsNeutralized = 0;

    for (const node of candidates) {
      if (!(node instanceof HTMLElement) || state.removedNodes.has(node)) {
        continue;
      }
      const signal = chapterPopupLayerSignal(node);
      if (!signal) {
        continue;
      }

      if (signal === "promo_card") {
        cardsMatched += 1;
      }

      const match = findChapterPopupLayerContainer(node);
      const target = match.node;
      if (!target || state.removedNodes.has(target) || isProtectedChapterNode(target)) {
        continue;
      }

      const wasReremoved = Number(document.documentElement.dataset.siteShieldPopupRemoved || "0") > 0;
      hideNode(target, "chapter-popup-layer", popupLayerDetails(target, node, wasReremoved, signal, match.depth));
      document.documentElement.dataset.siteShieldPopupRemoved = String(Number(document.documentElement.dataset.siteShieldPopupRemoved || "0") + 1);
      removed += 1;
      reremoved += wasReremoved ? 1 : 0;
      const backdropCount = neutralizePopupBackdrops(target, roots, wasReremoved, signal);
      removed += backdropCount;
      backdropsNeutralized += backdropCount;
    }

    if (removed > 0) {
      addPerfDelta({
        popupLayersRemoved: removed,
        popupLayersReremoved: reremoved,
        popupCardsMatched: cardsMatched,
        popupBackdropsNeutralized: backdropsNeutralized
      });
    }
    return removed;
  }

  function popupLayerSelector(rules) {
    const selectors = (rules.popupLayerSelectors || []).concat([
      "[class*='content-notification' i]",
      "[id*='content-notification' i]",
      "[class*='notification' i]",
      "[id*='notification' i]",
      "[role='dialog']",
      "[aria-modal='true']",
      "[style*='linear-gradient' i]",
      "[style*='flex-direction: column' i]",
      "[style*='border-radius: 16px' i]",
      "[style*='border-radius:16px' i]"
    ]);
    return heuristics.safeSelectorList(selectors).join(",") || "[role='dialog']";
  }

  function isChapterPopupLayerSignal(node) {
    return Boolean(chapterPopupLayerSignal(node));
  }

  function chapterPopupLayerSignal(node) {
    const text = trimText(node.textContent).toLowerCase();
    if (text.includes("content notification") || /^cancel$/i.test(text)) {
      return "content_notification";
    }
    if (isPromoCardSignature(node)) {
      return "promo_card";
    }
    if (looksAdNamed(node) && node.querySelector("button, a, [role='button']")) {
      return "ad_named_popup";
    }
    return "";
  }

  function isPromoCardSignature(node) {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    const text = trimText(node.textContent).toLowerCase();
    const hasPromoTerm = (state.pageRules.popupPromoTextTerms || []).some((term) => text.includes(String(term).toLowerCase()));
    const hasCta = Boolean(node.querySelector("a[href], button, [role='button']")) || /\b(click here|play now|claim|join|start)\b/i.test(text);
    if (!hasPromoTerm || !hasCta) {
      return false;
    }
    const style = getComputedStyle(node);
    const inline = node.getAttribute("style") || "";
    const gradient = /linear-gradient/i.test(inline) || /gradient/i.test(style.backgroundImage || "");
    const flexColumn = style.display === "flex" && style.flexDirection === "column";
    const rounded = Number.parseFloat(style.borderRadius) >= 10 || /border-radius\s*:\s*1[2-9]px/i.test(inline);
    const darkCard = /rgb\(15\s+17\s+34|rgba?\(\s*15\s*,\s*17\s*,\s*34/i.test(inline + " " + style.backgroundColor + " " + style.backgroundImage);
    const rect = node.getBoundingClientRect();
    return rect.width >= 180 && rect.height >= 80 && ((gradient && flexColumn) || (darkCard && rounded) || (flexColumn && rounded));
  }

  function findChapterPopupLayerContainer(node) {
    let current = node;
    let best = node;
    let depth = 0;
    let bestDepth = 0;
    while (current instanceof HTMLElement && current !== document.body && depth < 5) {
      if (isProtectedChapterNode(current)) {
        return { node: best, depth: bestDepth };
      }
      if (isLikelyPopupContainer(current)) {
        best = current;
        bestDepth = depth;
      }
      current = current.parentElement;
      depth += 1;
    }
    return { node: best, depth: bestDepth };
  }

  function isLikelyPopupContainer(node) {
    const text = trimText(node.textContent).toLowerCase();
    if (text.length > 500 || node.querySelector("img, picture, canvas, video, select, form, textarea")) {
      return false;
    }
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    const positioned = style.position === "fixed" || style.position === "absolute" || style.position === "sticky";
    return text.includes("content notification")
      || (text.includes("cancel") && looksAdNamed(node))
      || isPromoCardWrapper(node)
      || (positioned && rect.width >= 160 && rect.height >= 60 && looksAdNamed(node));
  }

  function isPromoCardWrapper(node) {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    const text = trimText(node.textContent).toLowerCase();
    const hasPromoTerm = (state.pageRules.popupPromoTextTerms || []).some((term) => text.includes(String(term).toLowerCase()));
    const positioned = style.position === "fixed" || style.position === "absolute" || style.position === "relative";
    return hasPromoTerm && positioned && rect.width >= 180 && rect.height >= 80 && rect.width <= window.innerWidth;
  }

  function neutralizePopupBackdrops(container, roots, wasReremoved, signal) {
    const rules = state.pageRules || {};
    const selector = heuristics.safeSelectorList(rules.popupBackdropSelectors || []).join(",");
    if (!selector) {
      return 0;
    }
    let removed = 0;
    const scanRoots = uniqueElements(roots.concat([document.documentElement]));
    const candidates = queryWithinRoots(scanRoots, selector, 20);
    for (const node of candidates) {
      if (!(node instanceof HTMLElement) || state.removedNodes.has(node) || node === container || container.contains(node)) {
        continue;
      }
      if (!isPopupBackdrop(node)) {
        continue;
      }
      hideNode(node, "chapter-popup-backdrop", popupLayerDetails(node, container, wasReremoved, signal, 0));
      removed += 1;
    }
    return removed;
  }

  function isPopupBackdrop(node) {
    const style = getComputedStyle(node);
    if (style.pointerEvents === "none" || style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    const rect = node.getBoundingClientRect();
    const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    const zIndex = Number.parseInt(style.zIndex, 10);
    return (style.position === "fixed" || style.position === "absolute")
      && (area / viewportArea >= 0.2 || (Number.isFinite(zIndex) && zIndex >= 10))
      && !node.querySelector("img, picture, canvas, video, select, form, textarea");
  }

  function popupLayerDetails(node, triggerNode, wasReremoved, signal, ancestorDepth) {
    return {
      action: "block",
      pageType: state.pageType,
      reason: wasReremoved ? "popup_layer_reinserted" : "popup_layer",
      signal,
      ancestorDepth,
      node: describeNode(node),
      trigger: describeNode(triggerNode),
      text: trimText(triggerNode.textContent),
      rect: rectSummary(node.getBoundingClientRect())
    };
  }

  function neutralizeChapterClickTraps(roots) {
    const rules = state.pageRules || {};
    const candidates = queryWithinRoots(
      roots,
      "a[href], [onclick], [role='button'], button, [data-href], [data-url]",
      Number(rules.maxOverlayScansPerPass || 80)
    );
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

  function removeChapterOrphanJunk(roots) {
    const rules = state.pageRules || {};
    const limit = Number(rules.maxOrphanScansPerPass || 60);
    let removed = 0;

    for (const selector of heuristics.safeSelectorList(rules.orphanSelectors || [])) {
      let nodes = [];
      try {
        nodes = queryWithinRoots(roots, selector, limit);
      } catch (error) {
        debugLog("invalid-orphan-selector", { selector });
        continue;
      }
      for (const node of nodes) {
        if (removed >= limit) {
          break;
        }
        if (node instanceof HTMLElement && shouldRemoveOrphanJunkNode(node)) {
          hideNode(node, "chapter-orphan-selector:" + selector, orphanDetails(node, "selector", selector));
          removed += 1;
        }
      }
    }

    const textCandidates = queryWithinRoots(
      roots,
      "button, a, span, p, div, small, label",
      Math.max(20, limit - removed)
    );
    let orphanXRemoved = 0;
    for (const node of textCandidates) {
      if (removed >= limit) {
        break;
      }
      if (!(node instanceof HTMLElement) || state.removedNodes.has(node) || isClickAllowedChapterControl(node)) {
        continue;
      }
      const reason = orphanTextReason(node);
      if (!reason || !shouldRemoveOrphanJunkNode(node)) {
        continue;
      }
      hideNode(node, "chapter-orphan-text:" + reason, orphanDetails(node, "text", reason));
      removed += 1;
      if (reason === "close") {
        orphanXRemoved += 1;
      }
    }

    if (removed > 0) {
      addPerfDelta({
        orphanJunkRemoved: removed,
        orphanXRemoved
      });
    }
    return removed;
  }

  function shouldRemoveOrphanJunkNode(node) {
    if (state.removedNodes.has(node) || isProtectedChapterNode(node) || isClickAllowedChapterControl(node)) {
      return false;
    }
    if (node.querySelector("img, picture, canvas, video, select, option, input, textarea, form")) {
      return false;
    }
    const text = trimText(node.textContent);
    const rect = node.getBoundingClientRect();
    const hasAdName = looksAdNamed(node);
    const adLabel = (state.pageRules.orphanTextTerms || []).some((term) => text.toLowerCase() === String(term).toLowerCase());
    const closeLabel = /^(x|\u00d7|close)$/i.test(text) && (hasAdName || (rect.width <= 64 && rect.height <= 64));
    return text.length <= 80 && (hasAdName || adLabel || closeLabel);
  }

  function looksAdNamed(node) {
    let current = node;
    let depth = 0;
    while (current instanceof HTMLElement && depth < 3) {
      if (/(^|[-_\s])(ad|ads|advert|advertisement|sponsor|popup|close|notify|notification)([-_\s]|$)/i.test(current.id + " " + current.className)) {
        return true;
      }
      current = current.parentElement;
      depth += 1;
    }
    return false;
  }

  function orphanTextReason(node) {
    const text = trimText(node.textContent);
    const lower = text.toLowerCase();
    if (/content notification/i.test(lower)) {
      return "content notification";
    }
    if (/^cancel$/i.test(text) && looksAdNamed(node)) {
      return "cancel";
    }
    for (const term of state.pageRules.orphanTextTerms || []) {
      if (lower === String(term).toLowerCase()) {
        return term;
      }
    }
    if (/^(x|\u00d7|close)$/i.test(text)) {
      return "close";
    }
    return "";
  }

  function orphanDetails(node, reason, trigger) {
    const rect = node.getBoundingClientRect();
    return {
      action: "block",
      pageType: state.pageType,
      reason: "orphan_" + reason,
      trigger,
      node: describeNode(node),
      text: trimText(node.textContent),
      rect: rectSummary(rect)
    };
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
    const now = Date.now();
    const cacheMs = Number(state.pageRules.readerRectCacheMs || 3000);
    if (state.readerRectsCache.length && now - state.readerCacheAt <= cacheMs) {
      return state.readerRectsCache;
    }

    const selectors = state.pageRules.readerSelectors || [];
    const rects = [];
    const roots = [];
    for (const cachedRoot of state.readerRootsCache) {
      if (cachedRoot instanceof Element && cachedRoot.isConnected) {
        const rect = cachedRoot.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          rects.push(rect);
          roots.push(cachedRoot);
        }
      }
    }
    if (rects.length) {
      state.readerRootsCache = roots;
      state.readerRectsCache = rects;
      state.readerCacheAt = now;
      return rects;
    }

    for (const selector of selectors) {
      try {
        for (const node of document.querySelectorAll(selector)) {
          const rect = node.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            rects.push(rect);
            roots.push(node);
          }
        }
      } catch (error) {
        debugLog("invalid-reader-selector", { selector });
      }
    }

    if (!rects.length && !state.readerRootsCache.length) {
      for (const image of document.querySelectorAll("img")) {
        const rect = image.getBoundingClientRect();
        if (rect.width >= 200 && rect.height >= 200) {
          rects.push(rect);
          roots.push(image);
          if (rects.length >= 12) {
            break;
          }
        }
      }
    } else if (!rects.length) {
      addPerfDelta({ expensiveScansSkipped: 1 });
    }
    state.readerRootsCache = roots.length ? roots : state.readerRootsCache.filter((node) => node.isConnected);
    state.readerRectsCache = rects;
    state.readerCacheAt = now;
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

  function isFooterJunkNode(node) {
    return Boolean(node.closest("footer, [id*='footer' i], [class*='footer' i], [id*='bottom' i], [class*='bottom' i]"));
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

  function isClickAllowedChapterControl(node) {
    if (state.pageType !== "chapter" || !(node instanceof Element)) {
      return false;
    }
    for (const selector of state.pageRules.clickAllowSelectors || []) {
      try {
        if (node.closest(selector)) {
          return true;
        }
      } catch (error) {
        debugLog("invalid-click-allow-selector", { selector });
      }
    }
    const link = node.closest("a[href]");
    if (!link) {
      return false;
    }
    const href = link.getAttribute("href") || "";
    return /^#/.test(href) || /\/manga\/[^/]+\/chapter-/i.test(href) || isFirstPartyUrl(href);
  }

  function shouldShieldChapterClick(target) {
    if (state.pageType !== "chapter" || !state.pageRules.clickShieldEnabled) {
      return false;
    }
    if (shouldSafeNavigateChapterLink(target)) {
      return true;
    }
    if (isClickAllowedChapterControl(target)) {
      return false;
    }

    const actionable = target.closest("a[href], button, [role='button'], [onclick], [data-href], [data-url]");
    if (actionable) {
      const url = actionable.getAttribute("href") || actionable.getAttribute("data-href") || actionable.getAttribute("data-url") || "";
      if (!url) {
        return Boolean(state.pageRules.shieldPlainChapterClicks);
      }
      const urlHost = heuristics.getUrlHostname(url, location.href);
      return Boolean(urlHost && !profiles.profileMatchesHostname(state.profile, urlHost)) || isChapterJunkUrl(url);
    }

    return Boolean(state.pageRules.shieldPlainReaderClicks && isInsideChapterReader(target))
      || Boolean(state.pageRules.shieldPlainChapterClicks && !actionable);
  }

  function isFirstPartyUrl(url) {
    const urlHost = heuristics.getUrlHostname(url, location.href);
    if (!urlHost) {
      return !/^(javascript|data|blob):/i.test(String(url || "").trim());
    }
    return profiles.profileMatchesHostname(state.profile, urlHost);
  }

  function shouldSafeNavigateChapterLink(target) {
    return Boolean(getSafeChapterLink(target));
  }

  function getSafeChapterLink(target) {
    if (!state.pageRules.safeNavigateFirstPartyAnchors || !(target instanceof Element)) {
      return "";
    }
    const link = target.closest("a[href]");
    if (!link) {
      return "";
    }
    const href = link.getAttribute("href") || "";
    if (/^#/.test(href) || !isFirstPartyUrl(href)) {
      return "";
    }
    try {
      const parsed = new URL(href, location.href);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "";
      }
      return parsed.href;
    } catch (error) {
      return "";
    }
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
    const candidates = state.pageType === "chapter"
      ? queryWithinRoots(
        roots,
        "[id*='ad' i], [class*='ad' i], [id*='popup' i], [class*='popup' i], [id*='overlay' i], [class*='overlay' i], [style*='position: fixed' i], [style*='position:fixed' i], [style*='z-index' i], iframe",
        120
      )
      : collectElements(roots, MAX_NODES_PER_PASS);

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

  function addPerfDelta(delta) {
    for (const [key, value] of Object.entries(delta || {})) {
      state.perfDelta[key] = Number(state.perfDelta[key] || 0) + Number(value || 0);
    }
    flushPerfSoon();
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
        domNodesProcessed: 0,
        clicksShielded: 0,
        opensBlocked: 0,
        duplicateOpenAttemptsBlocked: 0,
        orphanJunkRemoved: 0,
        footerJunkGroupsRemoved: 0,
        popupLayersRemoved: 0,
        popupLayersReremoved: 0,
        popupCardsMatched: 0,
        popupBackdropsNeutralized: 0,
        imageBlockPopupRemoved: 0,
        fullscreenOverlayRemoved: 0,
        xmlOherbutthedsBlocked: 0,
        brokenIframeRemoved: 0,
        orphanAdUiRemoved: 0,
        orphanXRemoved: 0,
        rearmedHijackAttemptsBlocked: 0,
        expensiveScansSkipped: 0
      };
      if (Object.values(delta).some((value) => Number(value || 0) > 0)) {
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

  function removeNode(node, reason, extraDetails) {
    if (!(node instanceof Element) || state.removedNodes.has(node)) {
      return;
    }
    state.removedNodes.add(node);
    recordEvent(config.EVENT_CATEGORIES.DOM, "DOM node removed", {
      action: "block",
      reason,
      pageType: state.pageType,
      node: describeNode(node),
      ...(extraDetails || {})
    });
    debugLog("node-removed", { reason, node: describeNode(node) });
    if (node.parentNode) {
      node.remove();
      return;
    }
    addPerfDelta({ hiddenOnlyFallbackCount: 1 });
    node.setAttribute("data-site-shield-hidden", "true");
    node.setAttribute("aria-hidden", "true");
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
