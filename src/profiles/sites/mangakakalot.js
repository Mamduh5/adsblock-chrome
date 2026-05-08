(function defineMangakakalotProfile(globalScope) {
  "use strict";

  globalScope.SiteShieldProfileDefinitions = globalScope.SiteShieldProfileDefinitions || [];
  globalScope.SiteShieldProfileDefinitions.push({
    id: "mangakakalot",
    displayName: "Mangakakalot",
    description: "Experimental profile for mangakakalot.gg and www.mangakakalot.gg.",
    matchPatterns: [
      "*://mangakakalot.gg/*",
      "*://www.mangakakalot.gg/*"
    ],
    hostPermissionPatterns: [
      "*://mangakakalot.gg/*",
      "*://www.mangakakalot.gg/*"
    ],
    domains: [
      "mangakakalot.gg",
      "www.mangakakalot.gg"
    ],
    includeSubdomains: false,
    dnrInitiatorDomains: [
      "mangakakalot.gg",
      "www.mangakakalot.gg"
    ],
    staticRuleIds: [
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      11
    ],
    hardBlockHosts: [
      "ad-maven.com",
      "adnxs.com",
      "adservice.google.com",
      "adsterra.com",
      "doubleclick.net",
      "exoclick.com",
      "googlesyndication.com",
      "mgid.com",
      "onclickads.net",
      "outbrain.com",
      "popads.net",
      "propellerads.com",
      "redirectingat.com",
      "taboola.com",
      "trafficjunky.net",
      "yllix.com",
      "adf.ly",
      "bc.vc",
      "clk.sh",
      "linkbucks.com",
      "ouo.io",
      "shorte.st",
      "tinyium.com",
      "seonetwork.net",
      "abcya3.games",
      "flax.to",
      "coolgamesunblocked.com",
      "crazygamesunblocked.net",
      "sunwin28.bz",
      "hi88s.com",
      "oherbuttheds.com",
      "xml.oherbuttheds.com",
      "yougetwhatyoupayfor.net",
      "cdnpf.com",
      "acscdn.com",
      "clammyendearedkeg.com",
      "nn.coolishrocked.com",
      "sync.adkernel.com",
      "cpm.pressize.com",
      "oundhertobeconsist.org",
      "chubbyexemplaryhardiness.com",
      "d3jzhqnvnvdy34.cloudfront.net",
      "d2dxy39sqorbhv.cloudfront.net"
    ],
    candidateBlockHosts: [
      "adskeeper.com",
      "adclick.g.doubleclick.net",
      "bidvertiser.com",
      "hilltopads.net",
      "juicyads.com",
      "popcash.net",
      "push-notifications.top",
      "revcontent.com",
      "trafficstars.com"
    ],
    staticBlockedHosts: [],
    dynamicBlockedHosts: [],
    hardDomSelectors: [
      "[id*='ad-overlay' i]",
      "[class*='ad-overlay' i]",
      "[id*='popup' i]",
      "[class*='popup' i]",
      "[id*='popunder' i]",
      "[class*='popunder' i]",
      "[id*='interstitial' i]",
      "[class*='interstitial' i]",
      "[class*='redirect' i]",
      "[class*='modal-ad' i]",
      "iframe[src*='doubleclick.net' i]",
      "iframe[src*='googlesyndication.com' i]",
      "iframe[src*='popads.net' i]",
      "iframe[src*='propellerads.com' i]"
    ],
    candidateDomSelectors: [
      "[id*='banner' i]",
      "[class*='banner' i]",
      "[id*='sponsor' i]",
      "[class*='sponsor' i]",
      "[id*='ads' i]",
      "[class*='ads' i]",
      "[id*='advert' i]",
      "[class*='advert' i]",
      "a[target='_blank'][href*='?']",
      "div[onclick]"
    ],
    suspiciousDomSelectors: [],
    suspiciousTextTerms: [
      "close",
      "continue",
      "download",
      "allow",
      "watch now",
      "play now",
      "open",
      "verify",
      "claim",
      "skip ad",
      "subscribe"
    ],
    suspiciousStorageKeyTerms: [
      "ad",
      "ads",
      "popup",
      "popunder",
      "redirect",
      "redir",
      "interstitial",
      "promo",
      "campaign",
      "clicktrap",
      "sponsor"
    ],
    candidateStorageKeyTerms: [
      "banner",
      "push",
      "track",
      "tracker",
      "utm",
      "zone"
    ],
    suspiciousCookieKeyTerms: [
      "ad",
      "ads",
      "popup",
      "popunder",
      "redirect",
      "redir",
      "interstitial",
      "promo",
      "campaign",
      "clicktrap",
      "sponsor"
    ],
    candidateCookieKeyTerms: [
      "banner",
      "push",
      "track",
      "tracker",
      "utm",
      "zone"
    ],
    exactCookieNames: [
      "126819",
      "PBFP250225",
      "__PPU_SESSION_1_2090108",
      "__PPU_puid",
      "__PPU_ppucnt",
      "__BI_SESSION_10144537",
      "__BI_SESSION_10144538",
      "isAddHistory"
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
      manga: {
        pathRegex: "^/manga/[^/]+/?$"
      },
      chapter: {
        pathRegex: "^/manga/[^/]+/chapter-[^/?#]+/?$"
      }
    },
    pageRules: {
      chapter: {
        hardBlockHosts: [
          "seonetwork.net",
          "abcya3.games",
          "flax.to",
          "coolgamesunblocked.com",
          "crazygamesunblocked.net",
          "sunwin28.bz",
          "hi88s.com",
          "oherbuttheds.com",
          "xml.oherbuttheds.com",
          "yougetwhatyoupayfor.net",
          "cdnpf.com",
          "acscdn.com",
          "clammyendearedkeg.com",
          "nn.coolishrocked.com",
          "sync.adkernel.com",
          "cpm.pressize.com",
          "oundhertobeconsist.org",
          "chubbyexemplaryhardiness.com",
          "d3jzhqnvnvdy34.cloudfront.net",
          "d2dxy39sqorbhv.cloudfront.net",
          "clicks.pipaffiliates.com",
          "weiledsteverm.org",
          "ghabovethec.info",
          "shopee.co.th",
          "xm.com"
        ],
        hardHostKeywords: [
          "open88",
          "fun88"
        ],
        hardDomSelectors: [
          ".chapter-content a[href*='seonetwork.net' i]",
          ".chapter-content a[href*='abcya3.games' i]",
          ".chapter-content a[href*='flax.to' i]",
          ".chapter-content a[href*='coolgamesunblocked.com' i]",
          ".chapter-content a[href*='crazygamesunblocked.net' i]",
          ".chapter-content a[href*='sunwin28.bz' i]",
          ".chapter-content a[href*='hi88s.com' i]",
          "a.image_block[target='_blank'][href*='xml.oherbuttheds.com/click' i]",
          "a[target='_blank'][href*='xml.oherbuttheds.com/click' i]",
          "img.kjalsgsdd[src*='xml.oherbuttheds.com/thumbnail' i]",
          "iframe[src^='undefined/iframe' i]",
          "iframe[src*='pid=undefined' i][src*='pbjs=1' i]",
          ".chapter-content a[href*='open88' i]",
          ".chapter-content a[href*='fun88' i]"
        ],
        junkTextTerms: [
          "seonetwork.net",
          "abcya3.games",
          "flax.to",
          "coolgamesunblocked.com",
          "crazygamesunblocked.net",
          "sunwin28.bz",
          "hi88s.com",
          "oherbuttheds.com",
          "xml.oherbuttheds.com",
          "yougetwhatyoupayfor.net",
          "cdnpf.com",
          "acscdn.com",
          "clammyendearedkeg.com",
          "nn.coolishrocked.com",
          "sync.adkernel.com",
          "cpm.pressize.com",
          "oundhertobeconsist.org",
          "chubbyexemplaryhardiness.com",
          "d3jzhqnvnvdy34.cloudfront.net",
          "d2dxy39sqorbhv.cloudfront.net",
          "clicks.pipaffiliates.com",
          "weiledsteverm.org",
          "ghabovethec.info",
          "shopee.co.th",
          "xm.com",
          "open88",
          "fun88"
        ],
        protectedSelectors: [
          "img",
          "picture",
          "select",
          "option",
          "form",
          "input",
          "textarea",
          ".chapter-list",
          ".chapter-nav",
          ".chapter-navigation",
          ".navi-change-chapter",
          ".chapter-control",
          ".chapter-controls",
          ".panel-chapter-info-top",
          ".panel-chapter-info-bottom",
          ".container-chapter-reader img",
          ".chapter-content img",
          ".comment",
          "#comments",
          "[class*='comment' i]"
        ],
        readerSelectors: [
          ".container-chapter-reader",
          ".chapter-content",
          "#vungdoc",
          ".reading-detail",
          ".chapter-c"
        ],
        overlayAllowSelectors: [
          ".chapter-nav",
          ".chapter-navigation",
          ".navi-change-chapter",
          ".chapter-control",
          ".chapter-controls",
          ".panel-chapter-info-top",
          ".panel-chapter-info-bottom",
          "#comments",
          "[class*='comment' i]"
        ],
        clickAllowSelectors: [
          ".chapter-nav",
          ".chapter-navigation",
          ".navi-change-chapter",
          ".chapter-control",
          ".chapter-controls",
          ".chapter-list",
          ".panel-chapter-info-top",
          ".panel-chapter-info-bottom",
          "select",
          "option",
          "form",
          "input",
          "textarea",
          "#comments",
          "[class*='comment' i]"
        ],
        orphanSelectors: [
          ".chapter-content [class*='advertisement' i]",
          ".chapter-content [id*='advertisement' i]",
          ".chapter-content [class*='advert' i]",
          ".chapter-content [id*='advert' i]",
          ".chapter-content [class*='adsby' i]",
          ".chapter-content [class*='ad-label' i]",
          ".container-chapter-reader [class*='advertisement' i]",
          ".container-chapter-reader [id*='advertisement' i]",
          ".container-chapter-reader [class*='advert' i]",
          ".container-chapter-reader [id*='advert' i]",
          ".container-chapter-reader [class*='adsby' i]",
          ".container-chapter-reader [class*='ad-label' i]",
          "[class*='content-notification' i]",
          "[id*='content-notification' i]",
          "a.image_block[target='_blank'][href*='xml.oherbuttheds.com/click' i]",
          "img.kjalsgsdd[src*='xml.oherbuttheds.com/thumbnail' i]",
          "[class*='notification' i] button",
          "[id*='notification' i] button"
        ],
        orphanTextTerms: [
          "advertisement",
          "advertisements",
          "sponsored",
          "content notification"
        ],
        popupLayerSelectors: [
          "a.image_block[target='_blank'][href*='xml.oherbuttheds.com/click' i]",
          "img.kjalsgsdd[src*='xml.oherbuttheds.com/thumbnail' i]",
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
        ],
        exactPopupSelectors: [
          "a.image_block[target='_blank'][href*='xml.oherbuttheds.com/click' i]",
          "a[target='_blank'][href*='xml.oherbuttheds.com/click' i]",
          "img.kjalsgsdd[src*='xml.oherbuttheds.com/thumbnail' i]",
          ".cbtoa"
        ],
        exactFullscreenOverlaySelectors: [
          "[style*='2147483646']",
          "[style*='position: fixed' i][style*='pointer-events: auto' i]",
          "[style*='position:fixed' i][style*='pointer-events:auto' i]"
        ],
        brokenIframeSelectors: [
          "iframe[src^='undefined/iframe' i]",
          "iframe[src^='//undefined/' i]",
          "iframe[src*='pbjs=1' i][src*='pid=undefined' i]"
        ],
        adBootstrapScriptUrls: [
          "https://yougetwhatyoupayfor.net/popup/popup-v4.js",
          "https://yougetwhatyoupayfor.net/6b19cf019d81.js",
          "https://cdnpf.com/6976e0119fd94812e8e10262.js",
          "https://acscdn.com/script/banner.js",
          "https://acscdn.com/script/suv5.js",
          "https://clammyendearedkeg.com/bn.js",
          "https://nn.coolishrocked.com/tnGqcEziwRRAkNS/126819",
          "https://yougetwhatyoupayfor.net/banners-web/mangakakalot.gg.js",
          "https://chubbyexemplaryhardiness.com/on.js",
          "https://chubbyexemplaryhardiness.com/get/2090108",
          "https://d2dxy39sqorbhv.cloudfront.net/"
        ],
        firstPartyAdScriptPaths: [
          "/js/ads/fly_e2c6a9cb8f6900e4bea0b82766581355.js",
          "/js/ads/clck-adu-kklgg.js",
          "/js/ads/admaven.js"
        ],
        adContainerSelectors: [
          "._0f84a320",
          ".ads-contain",
          ".banner-cus",
          ".banner-v2",
          ".banner-container",
          ".ads-banner"
        ],
        readerInjectedAdSelectors: [
          ".container-chapter-reader script[src]",
          ".container-chapter-reader iframe",
          ".container-chapter-reader div[style*='max-height:90px' i]",
          ".container-chapter-reader div[style*='max-height: 90px' i]"
        ],
        remainingBudgetKeys: [
          "126819",
          "PBFP250225",
          "__PPU_SESSION_1_2090108",
          "__PPU_puid",
          "__PPU_ppucnt",
          "__BI_SESSION_10144537",
          "__BI_SESSION_10144538",
          "isAddHistory"
        ],
        defaultDenyOffsiteNavigation: true,
        blockPopupOpenByDefault: true,
        popupAllowSameOriginPaths: [],
        offsiteNavigationDenyHosts: [
          "shopee.co.th",
          "xm.com",
          "clicks.pipaffiliates.com",
          "oundhertobeconsist.org",
          "weiledsteverm.org",
          "ghabovethec.info",
          "chubbyexemplaryhardiness.com"
        ],
        offsiteNavigationAllowHosts: [],
        affiliateHintHosts: [
          "s.shopee.co.th",
          "shopee.co.th",
          "xm.com",
          "clicks.pipaffiliates.com",
          "oundhertobeconsist.org",
          "weiledsteverm.org",
          "ghabovethec.info",
          "chubbyexemplaryhardiness.com",
          "d2dxy39sqorbhv.cloudfront.net"
        ],
        popupBackdropSelectors: [
          "[class*='overlay' i]",
          "[id*='overlay' i]",
          "[class*='backdrop' i]",
          "[id*='backdrop' i]",
          "[class*='modal' i]",
          "[id*='modal' i]",
          "[style*='position: fixed' i]",
          "[style*='position:fixed' i]"
        ],
        popupPromoTextTerms: [
          "free spins",
          "no deposit",
          "click here",
          "casino",
          "bonus",
          "bet",
          "win now",
          "play now"
        ],
        removalContainerSelectors: [
          "p",
          "li",
          "span",
          "div",
          "section"
        ],
        maxAnchorScansPerPass: 100,
        maxOverlayScansPerPass: 80,
        maxOrphanScansPerPass: 70,
        maxPopupScansPerPass: 35,
        readerRectCacheMs: 3000,
        overlayMinViewportWidthRatio: 0.72,
        overlayMinViewportHeightRatio: 0.4,
        overlayMinReaderOverlapRatio: 0.2,
        overlayNearTransparentOpacity: 0.15,
        clickShieldEnabled: true,
        clickShieldEvents: [
          "pointerdown",
          "mousedown",
          "click",
          "auxclick"
        ],
        shieldPlainReaderClicks: true,
        shieldPlainChapterClicks: true,
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
