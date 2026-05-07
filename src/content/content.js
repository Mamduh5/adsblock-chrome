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
    customBlockedHosts: [],
    customSelectors: [],
    removedNodes: new WeakSet(),
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
      if (heuristics.isSuspiciousUrl(state.profile, candidateUrl, state.customBlockedHosts, location.href)) {
        stopEvent(event);
        incrementStats({ blockedRedirects: 1 });
        recordEvent(config.EVENT_CATEGORIES.CLICK, "Click navigation blocked", {
          action: "block",
          url: candidateUrl,
          urlHost: heuristics.getUrlHostname(candidateUrl, location.href),
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
      } else if (heuristics.isSuspiciousUrl(state.profile, url, state.customBlockedHosts, location.href)) {
        recordEvent(config.EVENT_CATEGORIES.NETWORK, "Blocking URL heuristic matched", {
          action: "block",
          url,
          urlHost,
          node: describeNode(node)
        }, "block-url:" + url);
      }
    }
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

  function hideNode(node, reason) {
    if (state.removedNodes.has(node)) {
      return;
    }
    state.removedNodes.add(node);
    node.setAttribute("data-site-shield-hidden", "true");
    node.setAttribute("aria-hidden", "true");
    recordEvent(config.EVENT_CATEGORIES.DOM, "DOM node hidden", {
      action: "block",
      reason,
      node: describeNode(node)
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
})();
