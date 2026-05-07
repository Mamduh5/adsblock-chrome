(function exposeSiteShieldConfig(globalScope) {
  "use strict";

  const TARGET_DOMAIN = "example.com";

  const BAD_THIRD_PARTY_HOSTS = [
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
    "yllix.com"
  ];

  const REDIRECT_HOSTS = [
    "adf.ly",
    "bc.vc",
    "clk.sh",
    "linkbucks.com",
    "ouo.io",
    "shorte.st",
    "tinyium.com"
  ];

  const SUSPICIOUS_STORAGE_TERMS = [
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
  ];

  const PROTECTED_COOKIE_TERMS = [
    "auth",
    "csrf",
    "login",
    "member",
    "sess",
    "session",
    "token",
    "user"
  ];

  const DEFAULT_CUSTOM_SELECTORS = [
    "[id*='ad-overlay' i]",
    "[class*='ad-overlay' i]",
    "[id*='popup' i]",
    "[class*='popup' i]",
    "[id*='popunder' i]",
    "[class*='popunder' i]",
    "[id*='interstitial' i]",
    "[class*='interstitial' i]",
    "[class*='redirect' i]",
    "iframe[src*='doubleclick.net' i]",
    "iframe[src*='googlesyndication.com' i]",
    "iframe[src*='popads.net' i]",
    "iframe[src*='propellerads.com' i]"
  ];

  const TRAP_TEXT_PATTERN = "\\b(close|continue|download|allow|watch now|play now|open|verify|claim|skip ad|subscribe)\\b";
  const REDIRECT_URL_PATTERN = "(redirect|redir|out|go|click|track|pop|interstitial|campaign|promo)";

  globalScope.SiteShieldConfig = {
    TARGET_DOMAIN,
    BAD_THIRD_PARTY_HOSTS,
    REDIRECT_HOSTS,
    SUSPICIOUS_STORAGE_TERMS,
    PROTECTED_COOKIE_TERMS,
    DEFAULT_CUSTOM_SELECTORS,
    TRAP_TEXT_PATTERN,
    REDIRECT_URL_PATTERN,
    STATIC_RULESET_ID: "site_shield_static",
    DYNAMIC_RULE_ID_BASE: 10000,
    MAX_CUSTOM_HOST_RULES: 500,
    STORAGE_SETTINGS_KEY: "siteShieldSettings",
    SESSION_STATS_KEY: "siteShieldSessionStats"
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
