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
      3
    ],
    staticBlockedHosts: [
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
      "tinyium.com"
    ],
    dynamicBlockedHosts: [],
    suspiciousDomSelectors: [
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
