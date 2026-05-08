(function exposeSiteShieldConfig(globalScope) {
  "use strict";

  globalScope.SiteShieldConfig = {
    STATIC_RULESET_ID: "site_shield_static",
    DYNAMIC_RULE_ID_BASE: 10000,
    DYNAMIC_RULE_PROFILE_STRIDE: 1000,
    MAX_CUSTOM_HOST_RULES_PER_PROFILE: 250,
    DEFAULT_ACTIVATED_PROFILE_IDS: ["mangakakalot", "mamtpo"],
    STORAGE_SETTINGS_KEY: "siteShieldSettings",
    SESSION_STATS_KEY: "siteShieldSessionStats",
    RECENT_EVENTS_KEY: "siteShieldRecentEvents",
    MAX_RECENT_EVENTS: 80,
    MAX_EVENT_BUFFER: 40,
    EVENT_FLUSH_INTERVAL_MS: 1500,
    EVENT_RATE_LIMIT_BASIC: 8,
    EVENT_RATE_LIMIT_INSPECTION: 20,
    MAX_EVENT_STRING_LENGTH: 180,
    CONTENT_SCRIPT_ID_PREFIX: "site-shield-content-",
    PAGE_GUARD_SCRIPT_ID_PREFIX: "site-shield-page-guard-",
    PROFILE_RUNTIME_FILES: [
      "src/profiles/schema.js",
      "src/profiles/sites/mangakakalot.js",
      "src/profiles/sites/mamtpo.js",
      "src/profiles/index.js",
      "src/shared/config.js",
      "src/shared/heuristics.js"
    ],
    DNR_RESOURCE_TYPES: [
      "font",
      "image",
      "main_frame",
      "media",
      "object",
      "other",
      "ping",
      "script",
      "sub_frame",
      "websocket",
      "xmlhttprequest"
    ],
    EVENT_CATEGORIES: {
      NETWORK: "network",
      DOM: "dom",
      STORAGE: "storage",
      COOKIE: "cookie",
      CLICK: "click",
      OPEN: "open",
      PERMISSION: "permission",
      PROFILE: "profile",
      MANUAL: "manual"
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
