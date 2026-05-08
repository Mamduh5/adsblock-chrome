(function defineMamtpoProfile(globalScope) {
  "use strict";

  globalScope.SiteShieldProfileDefinitions = globalScope.SiteShieldProfileDefinitions || [];
  globalScope.SiteShieldProfileDefinitions.push({
    id: "mamtpo",
    displayName: "Mamtpo",
    description: "Watch-page cleanup profile for mamtpo.com and www.mamtpo.com.",
    matchPatterns: [
      "*://mamtpo.com/*",
      "*://www.mamtpo.com/*"
    ],
    hostPermissionPatterns: [
      "*://mamtpo.com/*",
      "*://www.mamtpo.com/*"
    ],
    domains: [
      "mamtpo.com",
      "www.mamtpo.com"
    ],
    includeSubdomains: false,
    dnrInitiatorDomains: [
      "mamtpo.com",
      "www.mamtpo.com"
    ],
    staticRuleIds: [],
    hardBlockHosts: [
      "t.ly",
      "ibit.ly"
    ],
    candidateBlockHosts: [],
    hardDomSelectors: [],
    candidateDomSelectors: [
      "#custom-promo-popup-overlay",
      "#first-gate",
      "#ad-overlay.click-overlay",
      "#sticky-banner-center",
      ".bcm-ads",
      ".side-skyscraper",
      ".promo-banner",
      "div.ad-float"
    ],
    suspiciousTextTerms: [
      "close",
      "continue",
      "download",
      "allow",
      "watch now",
      "play now",
      "open",
      "skip ad",
      "subscribe",
      "register"
    ],
    suspiciousStorageKeyTerms: [
      "ad",
      "ads",
      "popup",
      "promo",
      "campaign",
      "clicktrap",
      "preroll"
    ],
    candidateStorageKeyTerms: [
      "banner",
      "track",
      "tracker",
      "utm"
    ],
    suspiciousCookieKeyTerms: [
      "ad",
      "ads",
      "popup",
      "promo",
      "campaign",
      "clicktrap",
      "preroll"
    ],
    candidateCookieKeyTerms: [
      "banner",
      "track",
      "tracker",
      "utm"
    ],
    exactCookieNames: [
      "hide_promo_1111"
    ],
    protectedCookieTerms: [
      "auth",
      "csrf",
      "login",
      "member",
      "sess",
      "session",
      "token",
      "user"
    ],
    pageTypes: {
      home: {
        pathRegex: "^/$"
      },
      watch: {
        pathRegex: "^/[^/?#]+/?$",
        domAnySelectors: [
          "#asplayer",
          "#main-player"
        ]
      }
    },
    pageRules: {
      watch: {
        hardBlockHosts: [
          "t.ly",
          "ibit.ly"
        ],
        hardHostKeywords: [],
        hardDomSelectors: [
          "#custom-promo-popup-overlay",
          ".custom-popup-content",
          "#custom-popup-close",
          "#first-gate",
          "#close-gate",
          "#cta-stack",
          "#a-regis",
          "#btn-skip",
          "#btn-next",
          "#ad-overlay.click-overlay",
          ".bcm-ads",
          "#sticky-banner-center",
          "#close-banner",
          ".dual-banner-wrapper",
          ".side-skyscraper",
          ".side-left",
          ".side-right",
          ".wbnn",
          ".promo-banner",
          "div.ad-float",
          ".ad-close",
          ".promo-close"
        ],
        protectedSelectors: [
          "#main-player",
          "#main-player iframe",
          "#main-player iframe[src*='mee18player.com/play/' i]",
          "article",
          ".entry-title",
          ".post-title",
          ".related-posts",
          "#comments",
          "[class*='comment' i]"
        ],
        readerSelectors: [
          "#main-player",
          ".player-layout-main-wrapper",
          "article"
        ],
        overlayAllowSelectors: [
          "#main-player",
          "#main-player *",
          "article",
          ".related-posts",
          "#comments",
          "[class*='comment' i]"
        ],
        clickAllowSelectors: [
          "#main-player",
          "#main-player *",
          "article a[href]",
          ".related-posts a[href]",
          "#comments",
          "[class*='comment' i]"
        ],
        orphanSelectors: [
          ".ad-close",
          ".promo-close",
          "#close-gate",
          "#close-banner",
          "#custom-popup-close"
        ],
        orphanTextTerms: [
          "advertisement",
          "advertisements",
          "sponsored",
          "skip ad"
        ],
        adContainerSelectors: [
          "#custom-promo-popup-overlay",
          ".custom-popup-content",
          "#first-gate",
          "#cta-stack",
          "#a-regis",
          "#btn-skip",
          "#btn-next",
          "#ad-overlay.click-overlay",
          ".bcm-ads",
          "#sticky-banner-center",
          ".dual-banner-wrapper",
          ".side-skyscraper",
          ".side-left",
          ".side-right",
          ".wbnn",
          ".promo-banner",
          "div.ad-float"
        ],
        remainingBudgetKeys: [
          "hide_promo_1111"
        ],
        defaultDenyOffsiteNavigation: false,
        blockPopupOpenByDefault: false,
        offsiteNavigationDenyHosts: [
          "t.ly",
          "ibit.ly"
        ],
        affiliateHintHosts: [
          "t.ly",
          "ibit.ly"
        ],
        dynamicElementDenyHosts: [],
        clickShieldEnabled: true,
        clickShieldEvents: [
          "pointerdown",
          "mousedown",
          "click",
          "auxclick"
        ],
        shieldPlainReaderClicks: false,
        shieldPlainChapterClicks: false,
        safeNavigateFirstPartyAnchors: true,
        shieldMutationBurstMs: 1200
      }
    },
    pageGuard: {
      patchWindowOpen: true,
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
  });
})(typeof globalThis !== "undefined" ? globalThis : self);
