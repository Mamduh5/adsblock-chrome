importScripts(
  "../profiles/schema.js",
  "../profiles/sites/mangakakalot.js",
  "../profiles/index.js",
  "../shared/config.js",
  "../shared/heuristics.js"
);

const config = self.SiteShieldConfig;
const profiles = self.SiteShieldProfiles;
const heuristics = self.SiteShieldHeuristics;

const DEFAULT_GLOBAL_SETTINGS = {
  enabled: true,
  debug: false,
  profiles: {}
};

chrome.runtime.onInstalled.addListener(() => {
  initializeExtension();
});

chrome.runtime.onStartup.addListener(() => {
  initializeExtension();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "site-shield-cookie-cleanup") {
    scrubSuspiciousCookiesForAllProfiles("scheduled");
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) {
    return;
  }

  const profile = profileFromUrl(tab.url);
  if (profile) {
    scrubSuspiciousCookies(profile, "target-tab-complete");
  }
});

if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((event) => {
    const initiator = event.request.initiator || event.request.documentUrl || "";
    const profile = profileFromUrl(initiator);
    if (!profile) {
      return;
    }

    incrementStats(profile.id, { blockedRequests: 1 });
    recordEvent(profile.id, config.EVENT_CATEGORIES.DNR_BLOCK, "Request blocked", {
      ruleId: event.rule.ruleId,
      url: event.request.url,
      resourceType: event.request.type
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error("[Site Shield] message error", error);
      sendResponse({ ok: false, error: String(error && error.message ? error.message : error) });
    });
  return true;
});

async function initializeExtension() {
  const settings = await getSettings();
  await saveSettings(settings);
  await reconcileDynamicRules(settings);
  await chrome.alarms.create("site-shield-cookie-cleanup", { periodInMinutes: 15 });
  await scrubSuspiciousCookiesForAllProfiles("startup");
}

async function handleMessage(message, sender) {
  const type = message && message.type;
  if (!type) {
    return { ok: false, error: "Missing message type" };
  }

  if (type === "getState") {
    const settings = await getSettings();
    const profile = profileFromHostname(message.hostname || getSenderHost(sender));
    const profileSettings = profile ? getProfileSettings(settings, profile.id) : null;
    return {
      ok: true,
      inScope: Boolean(profile),
      enabled: Boolean(profile && settings.enabled && profileSettings.enabled),
      debug: settings.debug,
      profile,
      settings: profileSettings,
      globalSettings: settings
    };
  }

  if (type === "getPopupState") {
    const settings = await getSettings();
    const profile = profileFromHostname(message.hostname || "");
    const profileSettings = profile ? getProfileSettings(settings, profile.id) : null;
    const stats = profile ? await getStats(profile.id) : emptyStats();
    const events = profile ? await getRecentEvents(profile.id) : [];
    return {
      ok: true,
      inScope: Boolean(profile),
      enabled: settings.enabled,
      debug: settings.debug,
      profile,
      profiles: profiles.all().map(profileSummary),
      settings: profileSettings,
      stats,
      events
    };
  }

  if (type === "setGlobalEnabled") {
    const settings = await getSettings();
    settings.enabled = Boolean(message.enabled);
    await saveSettings(settings);
    await reconcileDynamicRules(settings);
    return { ok: true, settings };
  }

  if (type === "setProfileEnabled") {
    const settings = await getSettings();
    const profile = profiles.getById(message.profileId);
    if (!profile) {
      return { ok: false, error: "Unknown profile" };
    }
    getProfileSettings(settings, profile.id).enabled = Boolean(message.enabled);
    await saveSettings(settings);
    await reconcileDynamicRules(settings);
    return { ok: true, settings: getProfileSettings(settings, profile.id) };
  }

  if (type === "setDebug") {
    const settings = await getSettings();
    settings.debug = Boolean(message.debug);
    await saveSettings(settings);
    return { ok: true, settings };
  }

  if (type === "saveCustomHosts") {
    const settings = await getSettings();
    const profile = profiles.getById(message.profileId);
    if (!profile) {
      return { ok: false, error: "Unknown profile" };
    }
    const profileSettings = getProfileSettings(settings, profile.id);
    profileSettings.customBlockedHosts = heuristics.normalizeHostList(message.hosts || [])
      .filter((host) => !profiles.profileMatchesHostname(profile, host))
      .slice(0, config.MAX_CUSTOM_HOST_RULES_PER_PROFILE);
    await saveSettings(settings);
    await reconcileDynamicRules(settings);
    return { ok: true, settings: profileSettings };
  }

  if (type === "saveCustomSelectors") {
    const settings = await getSettings();
    const profile = profiles.getById(message.profileId);
    if (!profile) {
      return { ok: false, error: "Unknown profile" };
    }
    const profileSettings = getProfileSettings(settings, profile.id);
    profileSettings.customSelectors = heuristics.safeSelectorList(message.selectors || []);
    await saveSettings(settings);
    return { ok: true, settings: profileSettings };
  }

  if (type === "incrementStats") {
    const profile = profiles.getById(message.profileId) || profileFromHostname(message.hostname || getSenderHost(sender));
    if (profile) {
      await incrementStats(profile.id, message.delta || {});
    }
    return { ok: true };
  }

  if (type === "recordEvent") {
    const profile = profiles.getById(message.profileId) || profileFromHostname(message.hostname || getSenderHost(sender));
    if (profile) {
      await recordEvent(profile.id, message.category, message.summary, message.details || {});
    }
    return { ok: true };
  }

  if (type === "resetStats") {
    await resetStats(message.profileId || "");
    return { ok: true, stats: await getStats(message.profileId || "") };
  }

  if (type === "scrubCookiesNow") {
    const profile = profiles.getById(message.profileId);
    if (!profile) {
      return { ok: false, error: "Unknown profile" };
    }
    const result = await scrubSuspiciousCookies(profile, "manual-popup");
    await recordEvent(profile.id, config.EVENT_CATEGORIES.MANUAL_SCRUB, "Manual cookie scrub", result);
    return { ok: true, result };
  }

  if (type === "getRecentEvents") {
    return { ok: true, events: await getRecentEvents(message.profileId || "") };
  }

  return { ok: false, error: "Unknown message type: " + type };
}

async function getSettings() {
  const stored = await chrome.storage.local.get(config.STORAGE_SETTINGS_KEY);
  const current = stored[config.STORAGE_SETTINGS_KEY] || {};
  const settings = Object.assign({}, DEFAULT_GLOBAL_SETTINGS, current);
  settings.profiles = settings.profiles || {};

  // Migrate the first scaffold's single-site custom settings into the first
  // registered profile if a developer installed both versions while testing.
  if ((current.customBlockedHosts || current.customSelectors) && !Object.keys(settings.profiles).length) {
    const firstProfile = profiles.all()[0];
    if (firstProfile) {
      settings.profiles[firstProfile.id] = {
        enabled: true,
        customBlockedHosts: current.customBlockedHosts || [],
        customSelectors: current.customSelectors || []
      };
    }
  }

  for (const profile of profiles.all()) {
    settings.profiles[profile.id] = normalizeProfileSettings(settings.profiles[profile.id]);
  }

  return settings;
}

async function saveSettings(settings) {
  const normalized = Object.assign({}, DEFAULT_GLOBAL_SETTINGS, settings);
  normalized.enabled = Boolean(normalized.enabled);
  normalized.debug = Boolean(normalized.debug);
  normalized.profiles = normalized.profiles || {};

  for (const profile of profiles.all()) {
    normalized.profiles[profile.id] = normalizeProfileSettings(normalized.profiles[profile.id]);
  }

  await chrome.storage.local.set({ [config.STORAGE_SETTINGS_KEY]: normalized });
  return normalized;
}

function normalizeProfileSettings(profileSettings) {
  return Object.assign({
    enabled: true,
    customBlockedHosts: [],
    customSelectors: []
  }, {
    enabled: profileSettings && profileSettings.enabled !== false,
    customBlockedHosts: heuristics.normalizeHostList(profileSettings && profileSettings.customBlockedHosts || []),
    customSelectors: heuristics.safeSelectorList(profileSettings && profileSettings.customSelectors || [])
  });
}

function getProfileSettings(settings, profileId) {
  settings.profiles = settings.profiles || {};
  settings.profiles[profileId] = normalizeProfileSettings(settings.profiles[profileId]);
  return settings.profiles[profileId];
}

async function reconcileDynamicRules(settings) {
  await reconcileStaticRules(settings);

  const enableRulesets = settings.enabled && hasAnyEnabledProfile(settings) ? [config.STATIC_RULESET_ID] : [];
  const disableRulesets = settings.enabled && hasAnyEnabledProfile(settings) ? [] : [config.STATIC_RULESET_ID];
  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: enableRulesets,
    disableRulesetIds: disableRulesets
  });

  const existingDynamicRules = await chrome.declarativeNetRequest.getDynamicRules();
  const managedRuleIds = existingDynamicRules
    .filter((rule) => isManagedDynamicRuleId(rule.id))
    .map((rule) => rule.id);
  const addRules = settings.enabled ? buildAllDynamicRules(settings) : [];

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: managedRuleIds,
    addRules
  });
}

async function reconcileStaticRules(settings) {
  if (!chrome.declarativeNetRequest.updateStaticRules || !settings.enabled) {
    return;
  }

  const enableRuleIds = [];
  const disableRuleIds = [];
  for (const profile of profiles.all()) {
    const profileSettings = getProfileSettings(settings, profile.id);
    const target = profileSettings.enabled ? enableRuleIds : disableRuleIds;
    for (const ruleId of profile.staticRuleIds || []) {
      target.push(ruleId);
    }
  }

  if (enableRuleIds.length || disableRuleIds.length) {
    await chrome.declarativeNetRequest.updateStaticRules({
      rulesetId: config.STATIC_RULESET_ID,
      enableRuleIds,
      disableRuleIds
    });
  }
}

function hasAnyEnabledProfile(settings) {
  return profiles.all().some((profile) => getProfileSettings(settings, profile.id).enabled);
}

function buildAllDynamicRules(settings) {
  const rules = [];
  profiles.all().forEach((profile, profileIndex) => {
    const profileSettings = getProfileSettings(settings, profile.id);
    if (!profileSettings.enabled) {
      return;
    }

    const hosts = heuristics.normalizeHostList((profile.dynamicBlockedHosts || []).concat(profileSettings.customBlockedHosts || []));
    const usedOffsets = new Set();
    for (const host of hosts) {
      const offset = deterministicRuleOffset(profile.id, host, usedOffsets);
      usedOffsets.add(offset);
      rules.push({
        id: config.DYNAMIC_RULE_ID_BASE + (profileIndex * config.DYNAMIC_RULE_PROFILE_STRIDE) + offset,
        priority: 5,
        action: { type: "block" },
        condition: {
          initiatorDomains: profile.dnrInitiatorDomains,
          requestDomains: [host],
          resourceTypes: config.DNR_RESOURCE_TYPES
        }
      });
    }
  });
  return rules;
}

function deterministicRuleOffset(profileId, host, usedOffsets) {
  const maxOffset = config.DYNAMIC_RULE_PROFILE_STRIDE - 1;
  let hash = 0;
  const seed = profileId + ":" + host;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(index)) >>> 0;
  }
  let offset = (hash % maxOffset) + 1;
  while (usedOffsets.has(offset)) {
    offset = offset === maxOffset ? 1 : offset + 1;
  }
  return offset;
}

function isManagedDynamicRuleId(ruleId) {
  const min = config.DYNAMIC_RULE_ID_BASE;
  const max = min + (profiles.all().length * config.DYNAMIC_RULE_PROFILE_STRIDE);
  return ruleId >= min && ruleId < max;
}

async function scrubSuspiciousCookiesForAllProfiles(reason) {
  const settings = await getSettings();
  const results = [];
  if (!settings.enabled) {
    return results;
  }

  for (const profile of profiles.all()) {
    const profileSettings = getProfileSettings(settings, profile.id);
    if (profileSettings.enabled) {
      results.push(await scrubSuspiciousCookies(profile, reason));
    }
  }
  return results;
}

async function scrubSuspiciousCookies(profile, reason) {
  const settings = await getSettings();
  const profileSettings = getProfileSettings(settings, profile.id);
  if (!settings.enabled || !profileSettings.enabled) {
    return { checked: 0, deleted: 0 };
  }

  const cookies = await getProfileCookies(profile);
  let deleted = 0;

  for (const cookie of cookies) {
    if (!heuristics.shouldScrubCookieName(profile, cookie.name)) {
      continue;
    }

    // Only remove explicit ad/redirect-style cookies. Protected cookie terms
    // guard auth/session names even when a suspicious term is also present.
    const url = cookieUrl(cookie, profile);
    await chrome.cookies.remove({
      url,
      name: cookie.name,
      storeId: cookie.storeId
    });
    deleted += 1;
    await recordEvent(profile.id, config.EVENT_CATEGORIES.COOKIE_REMOVE, "Cookie removed", {
      reason,
      name: cookie.name,
      domain: cookie.domain,
      path: cookie.path
    });
  }

  if (deleted > 0) {
    await incrementStats(profile.id, { deletedStorageItems: deleted });
  }

  return { checked: cookies.length, deleted };
}

async function getProfileCookies(profile) {
  const seen = new Set();
  const cookies = [];
  for (const domain of profile.domains) {
    const domainCookies = await chrome.cookies.getAll({ domain });
    for (const cookie of domainCookies) {
      const key = [cookie.storeId, cookie.domain, cookie.path, cookie.name].join("|");
      if (!seen.has(key)) {
        seen.add(key);
        cookies.push(cookie);
      }
    }
  }
  return cookies;
}

function cookieUrl(cookie, profile) {
  const host = String(cookie.domain || profile.domains[0]).replace(/^\./, "");
  const scheme = cookie.secure ? "https" : "http";
  return scheme + "://" + host + (cookie.path || "/");
}

async function incrementStats(profileId, delta) {
  const stats = await readAllStats();
  const current = stats[profileId] || emptyStats();

  for (const key of Object.keys(emptyStats())) {
    current[key] += Number(delta[key] || 0);
  }

  stats[profileId] = current;
  await chrome.storage.session.set({ [config.SESSION_STATS_KEY]: stats });
}

async function getStats(profileId) {
  if (!profileId) {
    return emptyStats();
  }
  const stats = await readAllStats();
  return stats[profileId] || emptyStats();
}

async function resetStats(profileId) {
  const stats = await readAllStats();
  if (profileId) {
    delete stats[profileId];
  } else {
    for (const key of Object.keys(stats)) {
      delete stats[key];
    }
  }
  await chrome.storage.session.set({ [config.SESSION_STATS_KEY]: stats });
}

async function readAllStats() {
  const stored = await chrome.storage.session.get(config.SESSION_STATS_KEY);
  return stored[config.SESSION_STATS_KEY] || {};
}

function emptyStats() {
  return {
    blockedRequests: 0,
    removedOverlays: 0,
    blockedRedirects: 0,
    deletedStorageItems: 0
  };
}

async function recordEvent(profileId, category, summary, details) {
  const settings = await getSettings();
  if (!settings.debug) {
    return;
  }

  const stored = await chrome.storage.local.get(config.RECENT_EVENTS_KEY);
  const events = stored[config.RECENT_EVENTS_KEY] || [];
  events.unshift({
    id: Date.now() + ":" + Math.random().toString(36).slice(2),
    time: new Date().toISOString(),
    profileId,
    category,
    summary: summary || category,
    details: details || {}
  });

  await chrome.storage.local.set({
    [config.RECENT_EVENTS_KEY]: events.slice(0, config.MAX_RECENT_EVENTS)
  });
}

async function getRecentEvents(profileId) {
  const stored = await chrome.storage.local.get(config.RECENT_EVENTS_KEY);
  const events = stored[config.RECENT_EVENTS_KEY] || [];
  return profileId ? events.filter((event) => event.profileId === profileId) : events;
}

function profileFromUrl(url) {
  return profileFromHostname(heuristics.getUrlHostname(url));
}

function profileFromHostname(hostname) {
  return profiles.findByHostname(hostname);
}

function profileSummary(profile) {
  return {
    id: profile.id,
    displayName: profile.displayName,
    description: profile.description,
    domains: profile.domains,
    hostPermissionPatterns: profile.hostPermissionPatterns
  };
}

function getSenderHost(sender) {
  return heuristics.getUrlHostname(sender && sender.url ? sender.url : "");
}
