(function runSiteShieldContent() {
  "use strict";

  const config = globalThis.SiteShieldConfig;
  const profiles = globalThis.SiteShieldProfiles;
  const heuristics = globalThis.SiteShieldHeuristics;
  const host = resolveFrameHostname();
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
    mamtpoRemovedKeys: new Set(),
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
      floaterRequestBlocked: 0,
      floaterMainFrameBlocked: 0,
      floaterFetchBlocked: 0,
      floaterXhrBlocked: 0,
      floaterBeaconBlocked: 0,
      floaterWindowOpenBlocked: 0,
      floaterLocationBlocked: 0,
      floaterAnchorBlocked: 0,
      offsiteBlankPopupBlocked: 0,
      offsiteWindowOpenBlocked: 0,
      offsiteTopNavigationBlocked: 0,
      affiliateHostBlocked: 0,
      popupOpenBlocked: 0,
      blankPopupStubReturned: 0,
      offsitePopupStubReturned: 0,
      popupReuseAttemptBlocked: 0,
      chubbyGetBlocked: 0,
      chubbyOnJsBlocked: 0,
      withageConfigBlocked: 0,
      weiledstevermBlocked: 0,
      wbbcdLoaderBlocked: 0,
      openedProductChainBlocked: 0,
      newWindowPixelBlocked: 0,
      residualFramePopupBlocked: 0,
      badScriptSrcDenied: 0,
      badIframeSrcDenied: 0,
      frameContextPopupBlocked: 0,
      cloudfrontLoaderBlocked: 0,
      chubbyLoaderBlocked: 0,
      centeredPopupIframeRemoved: 0,
      popupSiblingFixedDivRemoved: 0,
      remainingBudgetKeysCleared: 0,
      undefinedIframeRemoved: 0,
      admavenOrClckLoaderBlocked: 0,
      rearmedHijackAttemptsBlocked: 0,
      expensiveScansSkipped: 0,
      promoPopupRemoved: 0,
      firstGateRemoved: 0,
      prerollOverlayDisabled: 0,
      stickyBannerRemoved: 0,
      sideBannerRemoved: 0,
      mainPlayerPreserved: 0,
      watchPageDetected: 0,
      prerollBranchBypassed: 0,
      mainPlayerForcedVisible: 0,
      centerAffiliateBlockRemoved: 0,
      adsContainerMainRemoved: 0,
      sideSkyscraperRemoved: 0,
      overlayReremoved: 0,
      watchCenterAffiliateBlockRemoved: 0,
      homePopupRemoved: 0,
      homeCenterAffiliateBlockRemoved: 0,
      homePromoImageRemoved: 0,
      adWrapperRemoved: 0,
      watchBannerWrapperRemoved: 0,
      homeBannerWrapperRemoved: 0
    },
    perfTimer: null,
    chapterClickCount: 0,
    lastMutationTime: 0,
    pageGuardListenerInstalled: false,
    watchPageDetectedRecorded: false,
    mainPlayerPreservedRecorded: false
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
    installMamtpoClickInterceptor();
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
        rearmedHijackAttemptsBlocked: event.detail && event.detail.afterMutationBurst ? 1 : 0,
        ...floaterPerfDelta(event.detail),
        ...finalBypassPerfDelta(event.detail)
      });
      recordEvent(config.EVENT_CATEGORIES.OPEN, "window.open blocked", Object.assign({ action: "block" }, event.detail || {}));
      debugLog("window-open-blocked", event.detail || {});
    });
    window.addEventListener("site-shield-click-shielded", (event) => {
      incrementStats({ blockedRedirects: 1 });
      addPerfDelta({
        clicksShielded: 1,
        rearmedHijackAttemptsBlocked: event.detail && event.detail.afterMutationBurst ? 1 : 0,
        ...floaterPerfDelta(event.detail),
        ...finalBypassPerfDelta(event.detail)
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
        rearmedHijackAttemptsBlocked: event.detail && event.detail.afterMutationBurst ? 1 : 0,
        ...floaterPerfDelta(event.detail),
        ...finalBypassPerfDelta(event.detail)
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
    window.addEventListener("site-shield-floater-blocked", (event) => {
      incrementStats({ blockedRedirects: 1 });
      addPerfDelta(Object.assign({}, floaterPerfDelta(event.detail), finalBypassPerfDelta(event.detail), primaryHostPerfDelta(event.detail)));
      recordEvent(config.EVENT_CATEGORIES.NETWORK, event.detail && event.detail.floater ? "Floater request blocked" : "Affiliate request blocked", Object.assign({
        action: "block",
        pageType: state.pageType
      }, event.detail || {}));
      debugLog("floater-blocked", event.detail || {});
    });
    window.addEventListener("site-shield-dynamic-src-blocked", (event) => {
      addPerfDelta(dynamicSrcPerfDelta(event.detail));
      recordEvent(config.EVENT_CATEGORIES.DOM, "Dynamic script/frame source denied", Object.assign({
        action: "block",
        pageType: state.pageType
      }, event.detail || {}));
      debugLog("dynamic-src-blocked", event.detail || {});
    });
  }

  function floaterPerfDelta(detail) {
    if (!detail || !isFloaterUrl(detail.url)) {
      return {};
    }
    const source = String(detail.source || "");
    return {
      floaterRequestBlocked: 1,
      floaterFetchBlocked: source === "fetch" ? 1 : 0,
      floaterXhrBlocked: source === "xhr" ? 1 : 0,
      floaterBeaconBlocked: source === "beacon" ? 1 : 0,
      floaterWindowOpenBlocked: source === "window_open" ? 1 : 0,
      floaterLocationBlocked: source === "location_assign" || source === "location_replace" || source === "location_href" ? 1 : 0,
      floaterAnchorBlocked: source === "anchor_blank" || source === "anchor_click" || source === "anchor" ? 1 : 0
    };
  }

  function finalBypassPerfDelta(detail) {
    if (!detail) {
      return {};
    }
    const source = String(detail.source || "");
    const host = String(detail.host || heuristics.getUrlHostname(detail.url || "", location.href) || "").toLowerCase();
    const affiliateHost = Boolean(detail.affiliateHost || isAffiliateHintHost(host));
    const openedProductChain = Boolean(detail.openedProductChain || detail.weiledsteverm || detail.wbbcdLoader);
    return {
      offsiteBlankPopupBlocked: detail.blankPopup ? 1 : 0,
      offsiteWindowOpenBlocked: source === "window_open" && (detail.offsite || affiliateHost || detail.blankPopup) ? 1 : 0,
      offsiteTopNavigationBlocked: source === "location_assign" || source === "location_replace" || source === "location_href" ? 1 : 0,
      affiliateHostBlocked: affiliateHost ? 1 : 0,
      popupOpenBlocked: source === "window_open" ? 1 : 0,
      blankPopupStubReturned: source === "window_open" && detail.blankPopup && detail.fakePopupReturned ? 1 : 0,
      offsitePopupStubReturned: source === "window_open" && detail.offsite && detail.fakePopupReturned ? 1 : 0,
      popupReuseAttemptBlocked: source === "window_open" && detail.fakePopupReturned ? 1 : 0,
      frameContextPopupBlocked: source === "window_open" && detail.frameContext ? 1 : 0,
      weiledstevermBlocked: detail.weiledsteverm || host === "weiledsteverm.org" ? 1 : 0,
      wbbcdLoaderBlocked: detail.wbbcdLoader || isWbbcdLoaderUrl(detail.url) ? 1 : 0,
      openedProductChainBlocked: openedProductChain ? 1 : 0,
      newWindowPixelBlocked: detail.newWindowPixel ? 1 : 0,
      residualFramePopupBlocked: source === "window_open" && detail.frameContext ? 1 : 0
    };
  }

  function dynamicSrcPerfDelta(detail) {
    if (!detail) {
      return {};
    }
    return {
      chubbyGetBlocked: detail.chubbyGet ? 1 : 0,
      chubbyOnJsBlocked: detail.chubbyOnJs ? 1 : 0,
      withageConfigBlocked: detail.withageConfig ? 1 : 0,
      weiledstevermBlocked: detail.weiledsteverm ? 1 : 0,
      wbbcdLoaderBlocked: detail.wbbcdLoader ? 1 : 0,
      openedProductChainBlocked: detail.openedProductChain ? 1 : 0,
      badScriptSrcDenied: detail.tag === "script" ? 1 : 0,
      badIframeSrcDenied: detail.tag === "iframe" ? 1 : 0
    };
  }

  function primaryHostPerfDelta(detail) {
    if (!detail) {
      return {};
    }
    return {
      chubbyGetBlocked: detail.chubbyGet ? 1 : 0,
      chubbyOnJsBlocked: detail.chubbyOnJs ? 1 : 0,
      withageConfigBlocked: detail.withageConfig ? 1 : 0,
      weiledstevermBlocked: detail.weiledsteverm ? 1 : 0,
      wbbcdLoaderBlocked: detail.wbbcdLoader ? 1 : 0,
      openedProductChainBlocked: detail.openedProductChain ? 1 : 0,
      newWindowPixelBlocked: detail.newWindowPixel ? 1 : 0
    };
  }

  function isFloaterUrl(url) {
    try {
      const parsed = new URL(String(url || ""), location.href);
      return parsed.hostname === "oundhertobeconsist.org" && /^\/floater(?:\/|$)/i.test(parsed.pathname);
    } catch (error) {
      return false;
    }
  }

  function isWbbcdLoaderUrl(url) {
    try {
      const parsed = new URL(String(url || ""), location.href);
      if (parsed.searchParams.get("wbbcd") === "1246039") {
        return true;
      }
      const rawUrl = String(url || "").toLowerCase();
      return (state.pageRules.blockedUrlTokens || []).some((token) => rawUrl.includes(String(token || "").toLowerCase()));
    } catch (error) {
      return false;
    }
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

  function installMamtpoClickInterceptor() {
    if (!state.profile || state.profile.id !== "mamtpo") {
      return;
    }

    for (const eventName of ["pointerdown", "mousedown", "click", "auxclick"]) {
      document.addEventListener(eventName, (event) => {
        if (!state.enabled) {
          return;
        }
        const target = event.target instanceof Element ? event.target : null;
        if (!target || isMamtpoProtectedNode(target)) {
          return;
        }

        const blockedSurface = target.closest([
          "#custom-promo-popup-overlay",
          ".custom-popup-content",
          "#asplayer",
          "#first-gate",
          ".gate-wrapper",
          ".gate-img",
          "#close-gate",
          "#cta-stack",
          "#a-regis",
          "#btn-skip",
          "#btn-next",
          "#ad-overlay",
          "#ad-overlay.click-overlay",
          ".click-overlay",
          ".bcm-ads",
          "#sticky-banner-center",
          ".dual-banner-wrapper",
          ".ads-container-main",
          ".ads-side-l",
          ".ads-side-r",
          ".ads-bottom-area",
          ".ads-all-group",
          ".ads-item",
          ".ads-close-btn",
          ".side-skyscraper",
          ".side-left",
          ".side-right",
          ".wbnn",
          ".promo-banner",
          "div.ad-float"
        ].join(","));
        const actionable = target.closest("a[href], button, [role='button'], [onclick], [data-href], [data-url]");
        const url = actionable
          ? actionable.getAttribute("href") || actionable.getAttribute("data-href") || actionable.getAttribute("data-url") || ""
          : "";

        if (!blockedSurface && !isMamtpoAffiliateUrl(url) && !isMamtpoExternalAdClick(target, url)) {
          return;
        }

        stopEvent(event);
        incrementStats({ blockedRedirects: 1 });
        addPerfDelta({
          clicksShielded: 1,
          prerollOverlayDisabled: blockedSurface && blockedSurface.matches("#ad-overlay, .click-overlay, #cta-stack, #a-regis, #btn-skip, #btn-next") ? 1 : 0
        });
        recordEvent(config.EVENT_CATEGORIES.CLICK, "Mamtpo ad click surface blocked", {
          action: "block",
          pageType: state.pageType,
          eventType: event.type,
          url,
          host: heuristics.getUrlHostname(url, location.href),
          target: describeNode(target),
          surface: blockedSurface ? describeNode(blockedSurface) : ""
        });
      }, true);
    }
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
      "link[rel~='preconnect'][href]",
      "link[rel~='dns-prefetch'][href]",
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

    refreshPageTypeFromDom();

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
      removed += removeAffiliateHints(roots);
      removed += removeKnownChapterAdScripts(roots);
      removed += removeExactChapterPopupFamily(roots);
      removed += removeFixedPopupSiblingDivs(null);
      removed += removeStableChapterAdContainers(roots);
      removed += removeReaderInjectedAdBlocks(roots);
    }
    if (isMamtpoWatchPage()) {
      removed += cleanupMamtpoWatchPage(roots);
    }
    if (isMamtpoHomePage()) {
      removed += cleanupMamtpoHomePage(roots);
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

  function refreshPageTypeFromDom() {
    const detected = detectPageType(state.profile);
    if (detected && detected !== "unknown" && detected !== state.pageType) {
      state.pageType = detected;
      state.pageRules = state.profile.pageRules && state.profile.pageRules[state.pageType] || {};
    }
    if (isMamtpoWatchPage()) {
      recordWatchPageDetected();
    }
  }

  function isMamtpoWatchPage() {
    return state.profile && state.profile.id === "mamtpo" && state.pageType === "watch";
  }

  function isMamtpoHomePage() {
    return state.profile && state.profile.id === "mamtpo" && state.pageType === "home";
  }

  function recordWatchPageDetected() {
    if (state.watchPageDetectedRecorded) {
      return;
    }
    state.watchPageDetectedRecorded = true;
    addPerfDelta({ watchPageDetected: 1 });
    recordEvent(config.EVENT_CATEGORIES.DOM, "Mamtpo watch page detected", {
      action: "observe",
      pageType: state.pageType,
      hasAsplayer: Boolean(document.querySelector("#asplayer")),
      hasMainPlayer: Boolean(document.querySelector("#main-player")),
      hasMee18Frame: Boolean(document.querySelector("#main-player iframe[src*='mee18player.com/play/' i]"))
    });
  }

  function cleanupMamtpoWatchPage(roots) {
    expirePageCookie("hide_promo_1111");

    let removed = 0;
    removed += removeMamtpoCenterAffiliateBlocks("watch");
    removed += removeMamtpoSelectorGroup(roots, [
      "#asplayer"
    ], "mamtpo-preroll-branch", { prerollBranchBypassed: 1, prerollOverlayDisabled: 1 });
    removed += removeMamtpoSelectorGroup(roots, [
      "#custom-promo-popup-overlay",
      ".custom-popup-content",
      "#custom-popup-close"
    ], "mamtpo-promo-popup", { promoPopupRemoved: 1 });
    removed += removeMamtpoSelectorGroup(roots, [
      "#first-gate",
      ".gate-wrapper",
      ".gate-img",
      "#close-gate"
    ], "mamtpo-first-gate", { firstGateRemoved: 1 });
    removed += removeMamtpoSelectorGroup(roots, [
      "#cta-stack",
      "#a-regis",
      "#btn-skip",
      "#btn-next",
      "#ad-overlay",
      "#ad-overlay.click-overlay",
      ".click-overlay",
      "#as_video"
    ], "mamtpo-preroll-overlay", { prerollOverlayDisabled: 1 });
    removed += removeMamtpoSelectorGroup(roots, [
      ".ads-container-main",
      ".ads-side-l",
      ".ads-side-r",
      ".ads-bottom-area",
      ".ads-all-group",
      ".ads-item",
      ".ads-close-btn"
    ], "mamtpo-ads-container-main", { adsContainerMainRemoved: 1, adWrapperRemoved: 1, watchBannerWrapperRemoved: 1 });
    removed += removeMamtpoSelectorGroup(roots, [
      ".bcm-ads",
      "#sticky-banner-center",
      "#close-banner",
      ".dual-banner-wrapper"
    ], "mamtpo-sticky-banner", { stickyBannerRemoved: 1, adWrapperRemoved: 1, watchBannerWrapperRemoved: 1 });
    removed += removeMamtpoSelectorGroup(roots, [
      ".player-layout-main-wrapper > .side-skyscraper",
      ".side-skyscraper",
      ".side-left",
      ".side-right",
      ".wbnn",
      ".promo-banner",
      "div.ad-float",
      ".ad-close",
      ".promo-close"
    ], "mamtpo-side-banner", { sideBannerRemoved: 1, sideSkyscraperRemoved: 1, adWrapperRemoved: 1, watchBannerWrapperRemoved: 1 });
    removed += removeMamtpoAffiliateImageBlocks();
    preserveMamtpoMainPlayer();
    return removed;
  }

  function cleanupMamtpoHomePage(roots) {
    let removed = 0;
    removed += removeMamtpoSelectorGroup(roots, [
      "#custom-promo-popup-home-1",
      "[id^='custom-promo-popup-home-']",
      ".custom-promo-overlay",
      ".custom-popup-content",
      "#close-home-1",
      "[id^='close-home-']",
      ".custom-popup-close"
    ], "mamtpo-home-popup", { homePopupRemoved: 1 });
    removed += removeMamtpoSelectorGroup(roots, [
      ".ads-container-main",
      ".ads-side-l",
      ".ads-side-r",
      ".ads-bottom-area",
      ".ads-all-group",
      ".ads-item",
      ".ads-close-btn",
      ".dual-banner-wrapper",
      ".side-skyscraper",
      ".side-left",
      ".side-right"
    ], "mamtpo-home-banner-wrapper", { homeBannerWrapperRemoved: 1, adWrapperRemoved: 1 });
    removed += removeMamtpoCenterAffiliateBlocks("home");
    removed += removeMamtpoHomePromoImages();
    return removed;
  }

  function removeMamtpoSelectorGroup(roots, selectors, reason, counterDelta) {
    const selector = heuristics.safeSelectorList(selectors).join(",");
    if (!selector) {
      return 0;
    }

    let removed = 0;
    for (const node of queryWithinRoots(roots, selector, 100)) {
      if (!(node instanceof HTMLElement) || !node.isConnected || state.removedNodes.has(node) || isMamtpoProtectedNode(node)) {
        continue;
      }
      const reinsertionKey = mamtpoReinsertionKey(node);
      const reremoved = Boolean(reinsertionKey && state.mamtpoRemovedKeys.has(reinsertionKey));
      removeNode(node, reason, {
        action: "block",
        pageType: state.pageType,
        node: describeNode(node),
        reremoved
      });
      if (reinsertionKey) {
        state.mamtpoRemovedKeys.add(reinsertionKey);
      }
      if (reremoved) {
        addPerfDelta({ overlayReremoved: 1 });
      }
      removed += 1;
    }

    if (removed > 0) {
      const delta = {};
      for (const [key, value] of Object.entries(counterDelta || {})) {
        delta[key] = Number(value || 0) * removed;
      }
      addPerfDelta(delta);
      recordEvent(config.EVENT_CATEGORIES.DOM, "Mamtpo watch UI removed", {
        action: "block",
        pageType: state.pageType,
        reason,
        count: removed
      });
    }
    return removed;
  }

  function mamtpoReinsertionKey(node) {
    if (!(node instanceof Element)) {
      return "";
    }
    const id = String(node.id || "");
    if (/^(asplayer|first-gate|ad-overlay|sticky-banner-center|custom-promo-popup-home-\d+|close-home-\d+)$/i.test(id)) {
      return "#" + id.toLowerCase();
    }
    const className = typeof node.className === "string" ? node.className : "";
    for (const classKey of ["bcm-ads", "dual-banner-wrapper", "ads-container-main", "custom-promo-overlay", "custom-popup-content"]) {
      if (node.classList && node.classList.contains(classKey)) {
        return "." + classKey + ":" + describeNode(node);
      }
    }
    if (/click-overlay/i.test(className)) {
      return ".click-overlay:" + describeNode(node);
    }
    if (node.tagName === "CENTER" && (isMamtpoCenterAffiliateStack(node, state.pageType === "home" ? "home" : "watch") || countMamtpoExternalImageLinks(node) >= 2)) {
      return "center-affiliate:" + node.querySelectorAll("a[href] > img").length + ":" + trimText(node.textContent);
    }
    return "";
  }

  function removeMamtpoAffiliateImageBlocks() {
    const player = document.querySelector("#main-player");
    if (!player) {
      return 0;
    }

    const candidates = new Set();
    collectMamtpoPlayerSiblings(player, candidates);
    for (const image of document.querySelectorAll("a[href] > img")) {
      const anchor = image.closest("a[href]");
      if (!anchor || !isMamtpoExternalUrl(anchor.getAttribute("href") || "")) {
        continue;
      }
      const target = closestMamtpoBannerContainer(anchor);
      if (target && isMamtpoNearPlayerArea(target)) {
        candidates.add(target);
      }
    }

    let removed = 0;
    for (const node of candidates) {
      if (!(node instanceof HTMLElement) || !node.isConnected || state.removedNodes.has(node) || isMamtpoProtectedNode(node) || !isMamtpoAffiliateBannerNode(node)) {
        continue;
      }
      removeNode(node, "mamtpo-affiliate-image-banner", {
        action: "block",
        pageType: state.pageType,
        node: describeNode(node)
      });
      removed += 1;
    }
    if (removed > 0) {
      addPerfDelta({ sideBannerRemoved: removed });
      recordEvent(config.EVENT_CATEGORIES.DOM, "Mamtpo affiliate image banner removed", {
        action: "block",
        pageType: state.pageType,
        count: removed
      });
    }
    return removed;
  }

  function removeMamtpoHomePromoImages() {
    let removed = 0;
    for (const image of document.querySelectorAll("img[src*='ball.gif' i][alt*='promo' i]")) {
      if (!(image instanceof HTMLImageElement) || !image.isConnected || state.removedNodes.has(image)) {
        continue;
      }
      const target = closestMamtpoPromoImageWrapper(image);
      if (!target || state.removedNodes.has(target) || isMamtpoProtectedNode(target) || !isMamtpoSafePromoImageWrapper(target)) {
        continue;
      }
      removeNode(target, "mamtpo-home-promo-image", {
        action: "block",
        pageType: state.pageType,
        node: describeNode(target),
        src: image.getAttribute("src") || ""
      });
      removed += 1;
    }
    if (removed > 0) {
      addPerfDelta({ homePromoImageRemoved: removed, adWrapperRemoved: removed });
      recordEvent(config.EVENT_CATEGORIES.DOM, "Mamtpo home promo image removed", {
        action: "block",
        pageType: state.pageType,
        count: removed
      });
    }
    return removed;
  }

  function closestMamtpoPromoImageWrapper(image) {
    let current = image instanceof HTMLElement ? image : null;
    let depth = 0;
    while (current && current !== document.body && depth < 4) {
      if (/^(center|p|div|section|aside|a)$/i.test(current.tagName)) {
        return current;
      }
      current = current.parentElement;
      depth += 1;
    }
    return image;
  }

  function isMamtpoSafePromoImageWrapper(node) {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    if (node.querySelector("article, .post, .post-card, .post-item, h1, h2, h3, #main-player")) {
      return false;
    }
    const imageCount = node.querySelectorAll("img").length;
    const text = trimText(node.textContent);
    return imageCount <= 4 && text.length <= 200;
  }

  function removeMamtpoCenterAffiliateBlocks(scope) {
    const centers = Array.from(document.querySelectorAll("article center, .entry-header center, .entry-content center, main center, center"));
    let removed = 0;
    for (const center of centers) {
      if (!(center instanceof HTMLElement) || !center.isConnected || state.removedNodes.has(center) || isMamtpoProtectedNode(center)) {
        continue;
      }
      if (!isMamtpoCenterAffiliateStack(center, scope)) {
        continue;
      }
      if (scope === "home" && !isMamtpoHomeAdCenter(center)) {
        continue;
      }
      if (scope !== "home" && !isMamtpoWatchAdCenter(center)) {
        continue;
      }
      removeNode(center, "mamtpo-center-affiliate-stack", {
        action: "block",
        pageType: state.pageType,
        node: describeNode(center),
        scope,
        externalImageLinks: countMamtpoExternalImageLinks(center)
      });
      const reinsertionKey = mamtpoReinsertionKey(center);
      if (reinsertionKey) {
        if (state.mamtpoRemovedKeys.has(reinsertionKey)) {
          addPerfDelta({ overlayReremoved: 1 });
        }
        state.mamtpoRemovedKeys.add(reinsertionKey);
      }
      removed += 1;
    }
    if (removed > 0) {
      addPerfDelta(scope === "home"
        ? { homeCenterAffiliateBlockRemoved: removed, adWrapperRemoved: removed }
        : { centerAffiliateBlockRemoved: removed, watchCenterAffiliateBlockRemoved: removed, adWrapperRemoved: removed, watchBannerWrapperRemoved: removed });
      recordEvent(config.EVENT_CATEGORIES.DOM, "Mamtpo center affiliate stack removed", {
        action: "block",
        pageType: state.pageType,
        scope,
        count: removed
      });
    }
    return removed;
  }

  function isMamtpoCenterAffiliateStack(node, scope) {
    if (!(node instanceof HTMLElement) || node.querySelector("#main-player, iframe[src*='mee18player.com/play/' i]")) {
      return false;
    }
    if (node.querySelector("h1, h2, h3, time, iframe[src*='mee18player.com/play/' i], video, canvas")) {
      return false;
    }
    if (scope === "home" && node.closest("article, .post, .post-card, .post-item, .entry, .loop, .grid-item")) {
      return false;
    }
    const imageCount = node.querySelectorAll("img").length;
    const externalImageLinks = countMamtpoExternalImageLinks(node);
    const knownAffiliateLinks = countMamtpoKnownAffiliateImageLinks(node);
    const bannerImages = countMamtpoBannerImages(node);
    const text = trimText(node.textContent);
    return imageCount > 0 && text.length <= 500 && (knownAffiliateLinks > 0 || externalImageLinks >= 2 || bannerImages >= 2);
  }

  function countMamtpoExternalImageLinks(node) {
    let count = 0;
    for (const anchor of node.querySelectorAll("a[href]")) {
      if (anchor.querySelector("img") && isMamtpoExternalUrl(anchor.getAttribute("href") || "")) {
        count += 1;
      }
    }
    return count;
  }

  function countMamtpoKnownAffiliateImageLinks(node) {
    let count = 0;
    for (const anchor of node.querySelectorAll("a[href]")) {
      if (anchor.querySelector("img") && isMamtpoKnownAffiliateUrl(anchor.getAttribute("href") || "")) {
        count += 1;
      }
    }
    return count;
  }

  function countMamtpoBannerImages(node) {
    let count = 0;
    for (const image of node.querySelectorAll("img")) {
      const src = image.getAttribute("src") || "";
      const alt = image.getAttribute("alt") || "";
      const name = [src, alt, image.id || "", typeof image.className === "string" ? image.className : ""].join(" ");
      const width = Number(image.getAttribute("width") || image.naturalWidth || image.width || 0);
      const height = Number(image.getAttribute("height") || image.naturalHeight || image.height || 0);
      const bannerNamed = /banner|promo|ads?|affiliate|bet|casino|slot|ball/i.test(name);
      const bannerFile = /\.(?:gif|jpe?g|png|webp)(?:[?#]|$)/i.test(src);
      const bannerShape = width >= 250 && height > 0 && width / Math.max(1, height) >= 2.2;
      if (bannerNamed || bannerFile && bannerShape || /\.gif(?:[?#]|$)/i.test(src)) {
        count += 1;
      }
    }
    return count;
  }

  function isMamtpoHomeAdCenter(node) {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    if (node.querySelector("article, .post, .post-card, .post-item, h1, h2, h3")) {
      return false;
    }
    return countMamtpoKnownAffiliateImageLinks(node) > 0 || countMamtpoExternalImageLinks(node) >= 2 || countMamtpoBannerImages(node) >= 2;
  }

  function isMamtpoWatchAdCenter(node) {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    if (isMamtpoNearPlayerArea(node)) {
      return true;
    }
    if (!node.closest("article, .entry-header, .entry-content, main, .player-layout-main-wrapper")) {
      return false;
    }
    if (node.querySelector(".related-posts, #comments, [class*='comment' i]")) {
      return false;
    }
    return countMamtpoKnownAffiliateImageLinks(node) > 0 || countMamtpoExternalImageLinks(node) >= 2 || countMamtpoBannerImages(node) >= 2;
  }

  function isMamtpoNearPlayerArea(node) {
    const markers = Array.from(document.querySelectorAll("#main-player, #asplayer"));
    if (!markers.length) {
      return Boolean(node.closest("article, .entry-header, .entry-content, main")) && countMamtpoExternalImageLinks(node) >= 2;
    }
    for (const marker of markers) {
      if (!(marker instanceof Element) || marker === node || isMamtpoProtectedNode(node)) {
        continue;
      }
      if (node.contains(marker) && marker.matches("#asplayer")) {
        return true;
      }
      if (marker.parentElement && marker.parentElement === node.parentElement && siblingDistance(node, marker) <= 6) {
        return true;
      }
      const container = nearestSharedContainer(node, marker);
      if (container && /^(article|main|section|div)$/i.test(container.tagName) && countMamtpoExternalImageLinks(node) >= 2) {
        return true;
      }
    }
    return false;
  }

  function siblingDistance(a, b) {
    if (!a || !b || a.parentElement !== b.parentElement) {
      return Number.POSITIVE_INFINITY;
    }
    const siblings = Array.from(a.parentElement.children);
    return Math.abs(siblings.indexOf(a) - siblings.indexOf(b));
  }

  function nearestSharedContainer(a, b) {
    let current = a.parentElement;
    let depth = 0;
    while (current && current !== document.body && depth < 4) {
      if (current.contains(b)) {
        return current;
      }
      current = current.parentElement;
      depth += 1;
    }
    return null;
  }

  function collectMamtpoPlayerSiblings(player, candidates) {
    const parent = player.parentElement;
    if (!parent) {
      return;
    }
    for (const direction of ["previousElementSibling", "nextElementSibling"]) {
      let current = player[direction];
      let depth = 0;
      while (current instanceof HTMLElement && depth < 4) {
        candidates.add(current);
        current = current[direction];
        depth += 1;
      }
    }
  }

  function closestMamtpoBannerContainer(node) {
    let current = node instanceof HTMLElement ? node : null;
    let depth = 0;
    while (current && current !== document.body && depth < 4) {
      if (isMamtpoProtectedNode(current)) {
        return null;
      }
      if (/^(p|div|section|figure|aside)$/i.test(current.tagName)) {
        return current;
      }
      current = current.parentElement;
      depth += 1;
    }
    return node instanceof HTMLElement ? node : null;
  }

  function isMamtpoAffiliateBannerNode(node) {
    if (!(node instanceof HTMLElement) || isMamtpoProtectedNode(node)) {
      return false;
    }
    if (node.querySelector("iframe, video, canvas, #asplayer, #main-player")) {
      return false;
    }
    const anchors = Array.from(node.querySelectorAll("a[href]"));
    const images = node.querySelectorAll("img");
    if (!anchors.length || !images.length) {
      return false;
    }
    const hasAffiliateLink = anchors.some((anchor) => isMamtpoExternalUrl(anchor.getAttribute("href") || ""));
    const namedAd = /(^|[-_\s])(ad|ads|advert|affiliate|banner|promo|sponsor|wbnn)([-_\s]|$)/i.test(node.id + " " + node.className);
    const text = trimText(node.textContent);
    return text.length <= 160 && (hasAffiliateLink || namedAd);
  }

  function preserveMamtpoMainPlayer() {
    const player = document.querySelector("#main-player");
    if (!(player instanceof HTMLElement)) {
      return;
    }

    revealMamtpoPlayerElement(player);
    for (const frame of player.querySelectorAll("iframe")) {
      if (frame instanceof HTMLElement) {
        revealMamtpoPlayerElement(frame);
      }
    }

    if (!state.mainPlayerPreservedRecorded) {
      state.mainPlayerPreservedRecorded = true;
      addPerfDelta({ mainPlayerPreserved: 1, mainPlayerForcedVisible: 1 });
      recordEvent(config.EVENT_CATEGORIES.DOM, "Mamtpo main player preserved", {
        action: "observe",
        pageType: state.pageType,
        hasIframe: Boolean(player.querySelector("iframe")),
        hasMee18Frame: Boolean(player.querySelector("iframe[src*='mee18player.com/play/' i]"))
      });
    }
  }

  function revealMamtpoPlayerElement(node) {
    node.removeAttribute("hidden");
    node.removeAttribute("aria-hidden");
    node.removeAttribute("data-site-shield-hidden");
    node.style.setProperty("display", "block", "important");
    node.style.setProperty("visibility", "visible", "important");
    node.style.setProperty("opacity", "1", "important");
    node.style.setProperty("pointer-events", "auto", "important");
  }

  function isMamtpoProtectedNode(node) {
    if (!(node instanceof Element)) {
      return false;
    }
    if (node.matches("#main-player") || node.closest("#main-player")) {
      return true;
    }
    return Boolean(node.querySelector && node.querySelector("#main-player, iframe[src*='mee18player.com/play/' i]"));
  }

  function isMamtpoAffiliateUrl(url) {
    return isMamtpoKnownAffiliateUrl(url);
  }

  function isMamtpoKnownAffiliateUrl(url) {
    const host = heuristics.getUrlHostname(url, location.href).toLowerCase();
    if (!host) {
      return false;
    }
    return [
      "t.ly",
      "ibit.ly",
      "cutt.ly",
      "cutly.cloud",
      "rebrand.ly",
      "ccx1.net",
      "maryelschool.org",
      "momentcar.com",
      "bad-ems.info",
      "googles.video"
    ].some((domain) => host === domain || host.endsWith("." + domain));
  }

  function isMamtpoExternalUrl(url) {
    const host = heuristics.getUrlHostname(url, location.href);
    if (!host) {
      return false;
    }
    return !profiles.profileMatchesHostname(state.profile, host);
  }

  function isMamtpoExternalAdClick(target, url) {
    if (!url || !isMamtpoExternalUrl(url) || !(target instanceof Element)) {
      return false;
    }
    return Boolean(target.closest("center, .ads-container-main, .ads-all-group, .ads-item, .dual-banner-wrapper, .side-skyscraper, .promo-banner, .wbnn, div.ad-float"));
  }

  function expirePageCookie(name) {
    try {
      const encodedName = encodeURIComponent(name);
      document.cookie = encodedName + "=; Max-Age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
      document.cookie = encodedName + "=; Max-Age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=." + location.hostname.replace(/^www\./i, "");
    } catch (error) {
      debugLog("cookie-expire-failed", { name, error: String(error) });
    }
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
    let admavenOrClck = 0;
    let cloudfront = 0;
    let chubby = 0;
    let wbbcd = 0;
    let weiled = 0;
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
      admavenOrClck += /\/js\/ads\/(admaven|clck-adu-kklgg)\.js/i.test(src) ? 1 : 0;
      cloudfront += /:\/\/d2dxy39sqorbhv\.cloudfront\.net\//i.test(src) ? 1 : 0;
      chubby += /:\/\/chubbyexemplaryhardiness\.com\/(on\.js|get\/2090108)/i.test(src) ? 1 : 0;
      wbbcd += isWbbcdLoaderUrl(src) ? 1 : 0;
      weiled += /:\/\/weiledsteverm\.org\//i.test(src) ? 1 : 0;
    }
    if (removed > 0) {
      addPerfDelta({
        blockedAdBootstrapScripts: removed - firstParty,
        blockedFirstPartyAdLoader: firstParty,
        admavenOrClckLoaderBlocked: admavenOrClck,
        cloudfrontLoaderBlocked: cloudfront,
        chubbyLoaderBlocked: chubby,
        wbbcdLoaderBlocked: wbbcd,
        weiledstevermBlocked: weiled,
        openedProductChainBlocked: wbbcd + weiled
      });
    }
    return removed;
  }

  function removeAffiliateHints(roots) {
    const hints = queryWithinRoots(roots, "link[rel~='preconnect'][href], link[rel~='dns-prefetch'][href]", 30);
    let removed = 0;
    for (const link of hints) {
      if (!(link instanceof HTMLLinkElement) || state.removedNodes.has(link)) {
        continue;
      }
      const host = heuristics.getUrlHostname(link.getAttribute("href") || "", location.href);
      if (!isAffiliateHintHost(host)) {
        continue;
      }
      removeNode(link, "chapter-affiliate-resource-hint", {
        action: "block",
        pageType: state.pageType,
        host,
        rel: link.getAttribute("rel") || ""
      });
      removed += 1;
    }
    if (removed > 0) {
      addPerfDelta({ affiliateHostBlocked: removed });
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
        const prefixPath = expected.pathname === "/get/2090108";
        if (parsed.hostname === expected.hostname && (parsed.pathname === expected.pathname || prefixPath && parsed.pathname.startsWith(expected.pathname))) {
          return "third_party_ad_bootstrap";
        }
      } catch (error) {
        debugLog("invalid-ad-script-url", { exactUrl });
      }
    }
    if (isWbbcdLoaderUrl(parsed.href)) {
      return "wbbcd_loader";
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
        addPerfDelta({ brokenIframeRemoved: 1, undefinedIframeRemoved: 1 });
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
        addPerfDelta({ fixedPopupIframeRemoved: 1, centeredPopupIframeRemoved: 1 });
        removed += removeFixedPopupSiblingDivs(target);
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
    const rect = frame.getBoundingClientRect();
    const inline = frame.getAttribute("style") || "";
    return style.position === "fixed"
      && nearCssPercent(frame.style.top || style.top, 50)
      && nearCssPercent(frame.style.left || style.left, 50)
      && /translate\(\s*-50%\s*,\s*-50%\s*\)/i.test(inline + " " + (style.transform || ""))
      && Number.isFinite(zIndex)
      && zIndex >= 2147483647
      && rect.width >= 180
      && rect.width <= window.innerWidth
      && rect.height >= 80
      && rect.height <= window.innerHeight * 0.8;
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

  function removeFixedPopupSiblingDivs(anchorNode) {
    const roots = uniqueElements([anchorNode && anchorNode.parentElement, document.documentElement].filter(Boolean));
    let removed = 0;
    for (const node of queryWithinRoots(roots, "div[style*='2147483647'], div[style*='position: fixed' i], div[style*='position:fixed' i]", 50)) {
      if (!(node instanceof HTMLElement) || state.removedNodes.has(node) || anchorNode && node.contains(anchorNode) || isProtectedChapterNode(node)) {
        continue;
      }
      if (!isPopupSiblingFixedDiv(node)) {
        continue;
      }
      removeNode(node, "chapter-popup-sibling-fixed-div", {
        action: "block",
        pageType: state.pageType,
        node: describeNode(node),
        rect: rectSummary(node.getBoundingClientRect())
      });
      removed += 1;
    }
    if (removed > 0) {
      addPerfDelta({ popupSiblingFixedDivRemoved: removed });
    }
    return removed;
  }

  function isPopupSiblingFixedDiv(node) {
    const style = getComputedStyle(node);
    const zIndex = Number.parseInt(style.zIndex, 10);
    if (style.position !== "fixed" || !Number.isFinite(zIndex) || zIndex < 2147483647) {
      return false;
    }
    if (node.querySelector("img, picture, canvas, video, select, form, textarea")) {
      return false;
    }
    const text = trimText(node.textContent);
    const rect = node.getBoundingClientRect();
    const smallFragment = rect.width <= 100 && rect.height <= 70;
    const popupWrapper = rect.width >= 160 && rect.width <= window.innerWidth && rect.height >= 80 && rect.height <= window.innerHeight * 0.8;
    return text.length <= 30 && (smallFragment || popupWrapper);
  }

  function isBrokenChapterIframe(frame) {
    const src = String(frame.getAttribute("src") || "");
    if (!/^undefined\/iframe/i.test(src) && !/^\/\/undefined\//i.test(src) && !src.includes("undefined/iframe") && !(src.includes("pbjs=1") && src.includes("pid=undefined"))) {
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
        blockedAdBootstrapScripts: 0,
        blockedFirstPartyAdLoader: 0,
        fixedPopupIframeRemoved: 0,
        adContainerRemoved: 0,
        readerInjectedAdBlockRemoved: 0,
        hiddenOnlyFallbackCount: 0,
        floaterRequestBlocked: 0,
        floaterMainFrameBlocked: 0,
        floaterFetchBlocked: 0,
        floaterXhrBlocked: 0,
        floaterBeaconBlocked: 0,
        floaterWindowOpenBlocked: 0,
        floaterLocationBlocked: 0,
        floaterAnchorBlocked: 0,
        offsiteBlankPopupBlocked: 0,
        offsiteWindowOpenBlocked: 0,
        offsiteTopNavigationBlocked: 0,
        affiliateHostBlocked: 0,
        popupOpenBlocked: 0,
        blankPopupStubReturned: 0,
        offsitePopupStubReturned: 0,
        popupReuseAttemptBlocked: 0,
        chubbyGetBlocked: 0,
        chubbyOnJsBlocked: 0,
        withageConfigBlocked: 0,
        weiledstevermBlocked: 0,
        wbbcdLoaderBlocked: 0,
        openedProductChainBlocked: 0,
        newWindowPixelBlocked: 0,
        residualFramePopupBlocked: 0,
        badScriptSrcDenied: 0,
        badIframeSrcDenied: 0,
        frameContextPopupBlocked: 0,
        cloudfrontLoaderBlocked: 0,
        chubbyLoaderBlocked: 0,
        centeredPopupIframeRemoved: 0,
        popupSiblingFixedDivRemoved: 0,
        remainingBudgetKeysCleared: 0,
        undefinedIframeRemoved: 0,
        admavenOrClckLoaderBlocked: 0,
        rearmedHijackAttemptsBlocked: 0,
        expensiveScansSkipped: 0,
        promoPopupRemoved: 0,
        firstGateRemoved: 0,
        prerollOverlayDisabled: 0,
        stickyBannerRemoved: 0,
        sideBannerRemoved: 0,
        mainPlayerPreserved: 0,
        watchPageDetected: 0,
        prerollBranchBypassed: 0,
        mainPlayerForcedVisible: 0,
        centerAffiliateBlockRemoved: 0,
        adsContainerMainRemoved: 0,
        sideSkyscraperRemoved: 0,
        overlayReremoved: 0,
        watchCenterAffiliateBlockRemoved: 0,
        homePopupRemoved: 0,
        homeCenterAffiliateBlockRemoved: 0,
        homePromoImageRemoved: 0,
        adWrapperRemoved: 0,
        watchBannerWrapperRemoved: 0,
        homeBannerWrapperRemoved: 0
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

      const exactBudgetKey = isRemainingBudgetKey(key);
      if (!exactBudgetKey && !heuristics.shouldScrubStorageKey(state.profile, key)) {
        continue;
      }

      // Selective storage cleanup removes only profile-defined suspicious keys.
      // It intentionally does not clear the full storage area.
      try {
        storageArea.removeItem(key);
        deleted += 1;
        recordEvent(config.EVENT_CATEGORIES.STORAGE, "Storage key removed", {
          action: "block",
          area: label,
          key,
          reason: exactBudgetKey ? "remaining_popunder_budget" : "storage_heuristic"
        });
        if (exactBudgetKey) {
          addPerfDelta({ remainingBudgetKeysCleared: 1 });
        }
        debugLog("storage-key-deleted", { label, key });
      } catch (error) {
        debugLog("storage-delete-failed", { label, key, error: String(error) });
      }
    }

    if (deleted > 0) {
      incrementStats({ deletedStorageItems: deleted });
    }
  }

  function isRemainingBudgetKey(key) {
    return (state.pageRules.remainingBudgetKeys || []).some((value) => String(value) === String(key));
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
    return state.pageType === "chapter" && (Boolean(chapterJunkTrigger(url, "")) || isWbbcdLoaderUrl(url));
  }

  function isAffiliateHintHost(hostname) {
    const host = String(hostname || "").toLowerCase();
    if (!host) {
      return false;
    }
    const hosts = (state.pageRules.affiliateHintHosts || []).concat(state.pageRules.offsiteNavigationDenyHosts || []);
    return hosts.some((candidate) => heuristics.isSubdomainOrSame(host, candidate));
  }

  function detectPageType(profile) {
    const pathname = resolveFramePathname();
    const pageTypes = profile && profile.pageTypes || {};
    for (const [pageType, rule] of Object.entries(pageTypes)) {
      if (!rule) {
        continue;
      }
      if (!pageTypePathMatches(pathname, rule, pageType)) {
        continue;
      }
      if (!pageTypeDomMatches(rule)) {
        continue;
      }
      return pageType;
    }
    return "unknown";
  }

  function pageTypePathMatches(pathname, rule, pageType) {
    if (!rule.pathRegex) {
      return true;
    }
    try {
      return new RegExp(rule.pathRegex, "i").test(pathname);
    } catch (error) {
      debugLog("invalid-page-type-regex", { pageType, pattern: rule.pathRegex });
      return false;
    }
  }

  function pageTypeDomMatches(rule) {
    const anySelectors = heuristics.safeSelectorList(rule.domAnySelectors || []);
    const allSelectors = heuristics.safeSelectorList(rule.domAllSelectors || []);
    if (anySelectors.length && !anySelectors.some((selector) => safeQuerySelector(selector))) {
      return false;
    }
    if (allSelectors.length && !allSelectors.every((selector) => safeQuerySelector(selector))) {
      return false;
    }
    return true;
  }

  function safeQuerySelector(selector) {
    try {
      return document.querySelector(selector);
    } catch (error) {
      debugLog("invalid-page-type-dom-selector", { selector });
      return null;
    }
  }

  function resolveFrameHostname() {
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

  function resolveFramePathname() {
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
})();
