importScripts("../shared/config.js", "../shared/heuristics.js");

const config = self.SiteShieldConfig;
const heuristics = self.SiteShieldHeuristics;

const DEFAULT_SETTINGS = {
  enabled: true,
  debug: false,
  customBlockedHosts: [],
  customSelectors: []
};

chrome.runtime.onInstalled.addListener(() => {
  initializeExtension();
});

chrome.runtime.onStartup.addListener(() => {
  initializeExtension();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "site-shield-cookie-cleanup") {
    scrubSuspiciousCookies("scheduled");
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) {
    return;
  }

  const host = heuristics.getUrlHostname(tab.url);
  if (heuristics.isTargetHostname(host)) {
    scrubSuspiciousCookies("target-tab-complete");
  }
});

if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((event) => {
    const initiator = event.request.initiator || event.request.documentUrl || "";
    const host = heuristics.getUrlHostname(initiator);
    if (!heuristics.isTargetHostname(host)) {
      return;
    }

    incrementStats(host, { blockedRequests: 1 });
    debugLog("request-blocked", {
      host,
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
  await applyNetworkRules(settings);
  await chrome.alarms.create("site-shield-cookie-cleanup", { periodInMinutes: 15 });
  await scrubSuspiciousCookies("startup");
}

async function handleMessage(message, sender) {
  const type = message && message.type;
  if (!type) {
    return { ok: false, error: "Missing message type" };
  }

  if (type === "getState") {
    const settings = await getSettings();
    const host = message.hostname || getSenderHost(sender);
    return {
      ok: true,
      target: heuristics.isTargetHostname(host),
      enabled: settings.enabled && heuristics.isTargetHostname(host),
      debug: settings.debug,
      settings
    };
  }

  if (type === "getPopupState") {
    const settings = await getSettings();
    const host = message.hostname || "";
    const stats = await getStats(host);
    return {
      ok: true,
      target: heuristics.isTargetHostname(host),
      enabled: settings.enabled,
      debug: settings.debug,
      settings,
      stats
    };
  }

  if (type === "setEnabled") {
    const settings = await getSettings();
    settings.enabled = Boolean(message.enabled);
    await saveSettings(settings);
    await applyNetworkRules(settings);
    return { ok: true, settings };
  }

  if (type === "setDebug") {
    const settings = await getSettings();
    settings.debug = Boolean(message.debug);
    await saveSettings(settings);
    return { ok: true, settings };
  }

  if (type === "saveCustomHosts") {
    const settings = await getSettings();
    settings.customBlockedHosts = heuristics.normalizeHostList(message.hosts || [])
      .filter((host) => !heuristics.isTargetHostname(host))
      .slice(0, config.MAX_CUSTOM_HOST_RULES);
    await saveSettings(settings);
    await applyNetworkRules(settings);
    return { ok: true, settings };
  }

  if (type === "saveCustomSelectors") {
    const settings = await getSettings();
    settings.customSelectors = heuristics.safeSelectorList(message.selectors || []);
    await saveSettings(settings);
    return { ok: true, settings };
  }

  if (type === "incrementStats") {
    const host = message.hostname || getSenderHost(sender);
    await incrementStats(host, message.delta || {});
    return { ok: true };
  }

  if (type === "resetStats") {
    const host = message.hostname || "";
    await resetStats(host);
    return { ok: true, stats: await getStats(host) };
  }

  if (type === "scrubCookiesNow") {
    const result = await scrubSuspiciousCookies("manual-popup");
    return { ok: true, result };
  }

  return { ok: false, error: "Unknown message type: " + type };
}

async function getSettings() {
  const stored = await chrome.storage.local.get(config.STORAGE_SETTINGS_KEY);
  return Object.assign({}, DEFAULT_SETTINGS, stored[config.STORAGE_SETTINGS_KEY] || {});
}

async function saveSettings(settings) {
  const normalized = Object.assign({}, DEFAULT_SETTINGS, settings);
  normalized.customBlockedHosts = heuristics.normalizeHostList(normalized.customBlockedHosts);
  normalized.customSelectors = heuristics.safeSelectorList(normalized.customSelectors);
  await chrome.storage.local.set({ [config.STORAGE_SETTINGS_KEY]: normalized });
  return normalized;
}

async function applyNetworkRules(settings) {
  const enableRulesets = settings.enabled ? [config.STATIC_RULESET_ID] : [];
  const disableRulesets = settings.enabled ? [] : [config.STATIC_RULESET_ID];
  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: enableRulesets,
    disableRulesetIds: disableRulesets
  });

  const existingDynamicRules = await chrome.declarativeNetRequest.getDynamicRules();
  const oldCustomRuleIds = existingDynamicRules
    .filter((rule) => rule.id >= config.DYNAMIC_RULE_ID_BASE)
    .map((rule) => rule.id);

  const addRules = settings.enabled
    ? buildCustomHostRules(settings.customBlockedHosts)
    : [];

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldCustomRuleIds,
    addRules
  });
}

function buildCustomHostRules(hosts) {
  return heuristics.normalizeHostList(hosts).map((host, index) => ({
    id: config.DYNAMIC_RULE_ID_BASE + index,
    priority: 5,
    action: { type: "block" },
    condition: {
      initiatorDomains: [config.TARGET_DOMAIN],
      requestDomains: [host],
      resourceTypes: [
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
      ]
    }
  }));
}

async function scrubSuspiciousCookies(reason) {
  const settings = await getSettings();
  if (!settings.enabled) {
    return { checked: 0, deleted: 0 };
  }

  const cookies = await chrome.cookies.getAll({ domain: config.TARGET_DOMAIN });
  let deleted = 0;

  for (const cookie of cookies) {
    if (!heuristics.shouldScrubCookieName(cookie.name)) {
      continue;
    }

    // Only remove explicit ad/redirect-style cookies. Auth and session-like names
    // are guarded in the shared heuristic and are intentionally left in place.
    const url = cookieUrl(cookie);
    await chrome.cookies.remove({
      url,
      name: cookie.name,
      storeId: cookie.storeId
    });
    deleted += 1;
    debugLog("cookie-deleted", { reason, name: cookie.name, domain: cookie.domain, path: cookie.path });
  }

  if (deleted > 0) {
    await incrementStats(config.TARGET_DOMAIN, { deletedStorageItems: deleted });
  }

  return { checked: cookies.length, deleted };
}

function cookieUrl(cookie) {
  const host = String(cookie.domain || config.TARGET_DOMAIN).replace(/^\./, "");
  const scheme = cookie.secure ? "https" : "http";
  return scheme + "://" + host + (cookie.path || "/");
}

async function incrementStats(hostname, delta) {
  const host = heuristics.isTargetHostname(hostname) ? heuristics.normalizeHost(hostname) : config.TARGET_DOMAIN;
  const stats = await readAllStats();
  const current = stats[host] || emptyStats();

  for (const key of Object.keys(emptyStats())) {
    current[key] += Number(delta[key] || 0);
  }

  stats[host] = current;
  await chrome.storage.session.set({ [config.SESSION_STATS_KEY]: stats });
}

async function getStats(hostname) {
  const host = heuristics.normalizeHost(hostname);
  const stats = await readAllStats();
  if (stats[host]) {
    return stats[host];
  }
  return emptyStats();
}

async function resetStats(hostname) {
  const host = heuristics.normalizeHost(hostname);
  const stats = await readAllStats();
  if (host) {
    delete stats[host];
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

function getSenderHost(sender) {
  return heuristics.getUrlHostname(sender && sender.url ? sender.url : "");
}

async function debugLog(eventName, details) {
  const settings = await getSettings();
  if (settings.debug) {
    console.info("[Site Shield]", eventName, details);
  }
}
