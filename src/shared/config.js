(function exposeSiteShieldConfig(globalScope) {
  "use strict";

  globalScope.SiteShieldConfig = {
    STATIC_RULESET_ID: "site_shield_static",
    DYNAMIC_RULE_ID_BASE: 10000,
    DYNAMIC_RULE_PROFILE_STRIDE: 1000,
    MAX_CUSTOM_HOST_RULES_PER_PROFILE: 250,
    DEFAULT_ACTIVATED_PROFILE_IDS: ["mangakakalot"],
    STORAGE_SETTINGS_KEY: "siteShieldSettings",
    SESSION_STATS_KEY: "siteShieldSessionStats",
    RECENT_EVENTS_KEY: "siteShieldRecentEvents",
    MAX_RECENT_EVENTS: 80,
    CONTENT_SCRIPT_ID_PREFIX: "site-shield-content-",
    PAGE_GUARD_SCRIPT_ID_PREFIX: "site-shield-page-guard-",
    PROFILE_RUNTIME_FILES: [
      "src/profiles/schema.js",
      "src/profiles/sites/mangakakalot.js",
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
      DNR_BLOCK: "dnr_block",
      CLICK_BLOCK: "click_block",
      OPEN_BLOCK: "open_block",
      DOM_REMOVE: "dom_remove",
      STORAGE_REMOVE: "storage_remove",
      COOKIE_REMOVE: "cookie_remove",
      MANUAL_SCRUB: "manual_scrub"
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
