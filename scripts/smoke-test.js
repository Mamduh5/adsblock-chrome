const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const grantedOrigins = new Set(["*://mangakakalot.gg/*", "*://www.mangakakalot.gg/*"]);
const storageLocal = {};
const storageSession = {};
let registeredScripts = [];
let dynamicRules = [{ id: 10001, condition: {}, action: { type: "block" } }];

function createEvent() {
  return { addListener() {} };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const context = {
  console,
  setTimeout,
  clearTimeout,
  globalThis: null,
  self: null,
  chrome: {
    runtime: {
      getManifest: () => ({ name: "Site Shield", version: "0.2.0-test" }),
      onInstalled: createEvent(),
      onStartup: createEvent(),
      onMessage: createEvent()
    },
    alarms: {
      onAlarm: createEvent(),
      create: async () => {}
    },
    tabs: {
      onUpdated: createEvent()
    },
    cookies: {
      getAll: async () => [],
      remove: async () => {}
    },
    declarativeNetRequest: {
      onRuleMatchedDebug: createEvent(),
      updateEnabledRulesets: async () => {},
      updateStaticRules: async () => {},
      getDynamicRules: async () => clone(dynamicRules),
      updateDynamicRules: async ({ removeRuleIds, addRules }) => {
        const remove = new Set(removeRuleIds || []);
        dynamicRules = dynamicRules.filter((rule) => !remove.has(rule.id)).concat(addRules || []);
      }
    },
    permissions: {
      contains: async ({ origins }) => (origins || []).every((origin) => grantedOrigins.has(origin)),
      request: async ({ origins }) => {
        for (const origin of origins || []) {
          grantedOrigins.add(origin);
        }
        return true;
      }
    },
    scripting: {
      getRegisteredContentScripts: async () => clone(registeredScripts),
      registerContentScripts: async (scripts) => {
        registeredScripts = registeredScripts.concat(clone(scripts));
      },
      unregisterContentScripts: async ({ ids }) => {
        const remove = new Set(ids || []);
        registeredScripts = registeredScripts.filter((script) => !remove.has(script.id));
      }
    },
    storage: {
      local: {
        get: async (key) => ({ [key]: storageLocal[key] }),
        set: async (values) => Object.assign(storageLocal, values)
      },
      session: {
        get: async (key) => ({ [key]: storageSession[key] }),
        set: async (values) => Object.assign(storageSession, values)
      }
    }
  }
};

context.globalThis = context;
context.self = context;
context.importScripts = (...files) => {
  for (const file of files) {
    const resolved = path.resolve(root, "src/background", file);
    vm.runInContext(fs.readFileSync(resolved, "utf8"), context, { filename: resolved });
  }
};

vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(root, "src/background/service_worker.js"), "utf8"),
  context,
  { filename: "src/background/service_worker.js" }
);

(async () => {
  const internals = context.SiteShieldBackgroundInternals;
  const profile = context.SiteShieldProfiles.getById("mangakakalot");

  assert(profile, "Mangakakalot profile should be registered");
  assert(profile.pageTypes.chapter, "Mangakakalot profile should define chapter page type");
  assert(profile.pageRules.chapter.hardBlockHosts.includes("seonetwork.net"), "chapter rules should include confirmed junk host");
  assert(profile.pageRules.chapter.hardHostKeywords.includes("open88"), "chapter rules should include OPEN88 keyword");
  assert(profile.pageRules.chapter.overlayAllowSelectors.length > 0, "chapter rules should include overlay allowlist");
  assert(profile.pageRules.chapter.clickAllowSelectors.length > 0, "chapter rules should include click allowlist");
  assert(profile.pageRules.chapter.readerSelectors.length > 0, "chapter rules should include reader selectors");
  assert(profile.pageRules.chapter.orphanSelectors.length > 0, "chapter rules should include orphan cleanup selectors");
  assert.strictEqual(profile.pageRules.chapter.clickShieldEnabled, true, "chapter click shield should be enabled");
  assert(profile.pageRules.chapter.clickShieldEvents.includes("pointerdown"), "chapter click shield should guard pointerdown");
  assert(profile.pageRules.chapter.clickShieldEvents.includes("mousedown"), "chapter click shield should guard mousedown");
  assert.strictEqual(profile.pageRules.chapter.shieldPlainChapterClicks, true, "chapter shield should cover plain chapter clicks");
  assert.strictEqual(profile.pageRules.chapter.safeNavigateFirstPartyAnchors, true, "chapter shield should safe-navigate first-party anchors");
  assert(profile.pageRules.chapter.orphanTextTerms.includes("content notification"), "chapter rules should include content notification cleanup");
  assert.strictEqual(await internals.hasProfileHostPermission(profile), true, "permission should be detected");

  const activated = await internals.activateProfile("mangakakalot", false);
  assert.strictEqual(activated.activated, true, "profile should activate");

  const contentScript = registeredScripts.find((script) => script.id === "site-shield-content-mangakakalot");
  const pageGuard = registeredScripts.find((script) => script.id === "site-shield-page-guard-mangakakalot");
  assert(contentScript, "isolated content script should register");
  assert(pageGuard, "page guard should register");
  assert.strictEqual(pageGuard.world, "MAIN", "page guard must run in MAIN world");
  assert(pageGuard.runAt === "document_start", "page guard should run at document_start");

  const snapshot = await internals.buildDebugSnapshot("mangakakalot", "mangakakalot.gg");
  assert.strictEqual(snapshot.activeProfileId, "mangakakalot", "snapshot should include active profile");
  assert(snapshot.perf, "snapshot should include performance counters");
  assert(Array.isArray(snapshot.profileTuningSummary.hardBlockHosts), "snapshot should include hard hosts");
  assert(Array.isArray(snapshot.profileTuningSummary.candidateBlockHosts), "snapshot should include candidate hosts");

  await internals.deactivateProfile("mangakakalot");
  assert.strictEqual(registeredScripts.length, 0, "deactivation should unregister managed scripts");
  assert.strictEqual(dynamicRules.length, 0, "deactivation should remove stale managed dynamic rules");

  console.log("smoke ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
