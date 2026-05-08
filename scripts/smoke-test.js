const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const grantedOrigins = new Set([
  "*://mangakakalot.gg/*",
  "*://www.mangakakalot.gg/*",
  "*://mamtpo.com/*",
  "*://www.mamtpo.com/*"
]);
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
  const mamtpoProfile = context.SiteShieldProfiles.getById("mamtpo");
  const staticRules = JSON.parse(fs.readFileSync(path.join(root, "rules/static_rules.json"), "utf8"));

  assert(profile, "Mangakakalot profile should be registered");
  assert(mamtpoProfile, "Mamtpo profile should be registered");
  assert(mamtpoProfile.pageTypes.home, "Mamtpo profile should define home page type");
  assert(mamtpoProfile.pageTypes.watch, "Mamtpo profile should define watch page type");
  assert(mamtpoProfile.pageTypes.watch.domAnySelectors.includes("#asplayer"), "Mamtpo watch type should detect asplayer DOM");
  assert(mamtpoProfile.pageTypes.watch.domAnySelectors.includes("#main-player"), "Mamtpo watch type should detect main player DOM");
  assert(mamtpoProfile.pageRules.watch.hardDomSelectors.includes("#custom-promo-popup-overlay"), "Mamtpo watch rules should remove promo popup");
  assert(mamtpoProfile.pageRules.watch.hardDomSelectors.includes("#first-gate"), "Mamtpo watch rules should remove first gate");
  assert(mamtpoProfile.pageRules.watch.hardDomSelectors.includes("#ad-overlay.click-overlay"), "Mamtpo watch rules should remove click overlay");
  assert(mamtpoProfile.pageRules.watch.hardDomSelectors.includes("#sticky-banner-center"), "Mamtpo watch rules should remove sticky banner");
  assert(mamtpoProfile.pageRules.watch.hardDomSelectors.includes(".side-skyscraper"), "Mamtpo watch rules should remove side skyscrapers");
  assert(mamtpoProfile.pageRules.watch.protectedSelectors.includes("#main-player"), "Mamtpo watch rules should protect main player");
  assert(mamtpoProfile.pageRules.watch.protectedSelectors.includes("#main-player iframe[src*='mee18player.com/play/' i]"), "Mamtpo watch rules should protect mee18player iframe");
  assert(mamtpoProfile.exactCookieNames.includes("hide_promo_1111"), "Mamtpo profile should include exact promo popup cookie");
  assert(mamtpoProfile.hardBlockHosts.includes("t.ly"), "Mamtpo profile should block t.ly CTA host");
  assert(mamtpoProfile.hardBlockHosts.includes("ibit.ly"), "Mamtpo profile should block ibit.ly CTA host");
  assert(profile.pageTypes.chapter, "Mangakakalot profile should define chapter page type");
  assert(profile.pageRules.chapter.hardBlockHosts.includes("seonetwork.net"), "chapter rules should include confirmed junk host");
  assert(profile.pageRules.chapter.hardBlockHosts.includes("xml.oherbuttheds.com"), "chapter rules should include exact popup host");
  assert(profile.hardBlockHosts.includes("yougetwhatyoupayfor.net"), "profile should hard-block confirmed ad bootstrap host");
  assert(profile.hardBlockHosts.includes("chubbyexemplaryhardiness.com"), "profile should hard-block remaining popunder host");
  assert(profile.hardBlockHosts.includes("d2dxy39sqorbhv.cloudfront.net"), "profile should hard-block final cloudfront loader host");
  assert(profile.staticRuleIds.includes(9), "profile should own final popunder static DNR rules");
  assert(profile.staticRuleIds.includes(10), "profile should own top-level floater navigation DNR rule");
  assert(profile.staticRuleIds.includes(11), "profile should own final CloudFront syxdd loader DNR rule");
  assert(profile.staticRuleIds.includes(12), "profile should own comprehensive chubby host DNR rule");
  assert(profile.staticRuleIds.includes(13), "profile should own withage config DNR rule");
  assert(profile.staticRuleIds.includes(14), "profile should own global chubby get top-level DNR rule");
  assert(profile.staticRuleIds.includes(15), "profile should own comprehensive weiledsteverm DNR rule");
  assert(profile.staticRuleIds.includes(16), "profile should own wbbcd loader DNR rule");
  assert(profile.staticRuleIds.includes(17), "profile should own global weiledsteverm top-level DNR rule");
  assert(staticRules.some((rule) => rule.id === 11 && rule.condition.requestDomains.includes("d2dxy39sqorbhv.cloudfront.net")), "static DNR should include host-level CloudFront syxdd loader rule");
  assert(staticRules.some((rule) => rule.id === 12 && rule.condition.requestDomains.includes("chubbyexemplaryhardiness.com") && rule.condition.resourceTypes.includes("main_frame")), "static DNR should include broad chubby chain rule");
  assert(staticRules.some((rule) => rule.id === 13 && rule.condition.regexFilter.includes("withagecomeswisdom")), "static DNR should include withage config rule");
  assert(staticRules.some((rule) => rule.id === 14 && rule.condition.urlFilter.includes("chubbyexemplaryhardiness.com/get/2090108")), "static DNR should include top-level chubby get rule");
  assert(staticRules.some((rule) => rule.id === 15 && rule.condition.requestDomains.includes("weiledsteverm.org") && rule.condition.resourceTypes.includes("main_frame")), "static DNR should include broad weiledsteverm chain rule");
  assert(staticRules.some((rule) => rule.id === 16 && rule.condition.regexFilter.includes("wbbcd=1246039")), "static DNR should include wbbcd loader rule");
  assert(staticRules.some((rule) => rule.id === 17 && rule.condition.urlFilter.includes("weiledsteverm.org")), "static DNR should include top-level weiledsteverm rule");
  assert(profile.exactCookieNames.includes("__PPU_SESSION_1_2090108"), "profile should include exact popunder budget cookie");
  assert(profile.pageRules.chapter.hardHostKeywords.includes("open88"), "chapter rules should include OPEN88 keyword");
  assert(profile.pageRules.chapter.overlayAllowSelectors.length > 0, "chapter rules should include overlay allowlist");
  assert(profile.pageRules.chapter.clickAllowSelectors.length > 0, "chapter rules should include click allowlist");
  assert(profile.pageRules.chapter.readerSelectors.length > 0, "chapter rules should include reader selectors");
  assert(profile.pageRules.chapter.orphanSelectors.length > 0, "chapter rules should include orphan cleanup selectors");
  assert(profile.pageRules.chapter.popupLayerSelectors.length > 0, "chapter rules should include popup layer selectors");
  assert(profile.pageRules.chapter.popupBackdropSelectors.length > 0, "chapter rules should include popup backdrop selectors");
  assert(profile.pageRules.chapter.popupLayerSelectors.some((selector) => selector.includes("linear-gradient")), "chapter popup selectors should include promo-card style signature");
  assert(profile.pageRules.chapter.popupPromoTextTerms.includes("free spins"), "chapter popup rules should include gambling promo terms");
  assert(profile.pageRules.chapter.exactPopupSelectors.some((selector) => selector.includes("image_block")), "chapter rules should include exact image_block popup selector");
  assert(profile.pageRules.chapter.exactFullscreenOverlaySelectors.some((selector) => selector.includes("2147483646")), "chapter rules should include exact fullscreen overlay selector");
  assert(profile.pageRules.chapter.brokenIframeSelectors.some((selector) => selector.includes("undefined/iframe")), "chapter rules should include broken iframe selector");
  assert(profile.pageRules.chapter.adBootstrapScriptUrls.some((url) => url.includes("popup-v4.js")), "chapter rules should include ad bootstrap script URLs");
  assert(profile.pageRules.chapter.firstPartyAdScriptPaths.includes("/js/ads/fly_e2c6a9cb8f6900e4bea0b82766581355.js"), "chapter rules should include exact first-party ad loader path");
  assert(profile.pageRules.chapter.firstPartyAdScriptPaths.includes("/js/ads/clck-adu-kklgg.js"), "chapter rules should include exact clck loader path");
  assert(profile.pageRules.chapter.firstPartyAdScriptPaths.includes("/js/ads/admaven.js"), "chapter rules should include exact admaven loader path");
  assert(profile.pageRules.chapter.adContainerSelectors.includes("._0f84a320"), "chapter rules should include stable ad container class");
  assert(profile.pageRules.chapter.readerInjectedAdSelectors.some((selector) => selector.includes("max-height")), "chapter rules should include reader-injected ad block selectors");
  assert(profile.pageRules.chapter.remainingBudgetKeys.includes("__PPU_ppucnt"), "chapter rules should include exact popunder storage budget keys");
  assert.strictEqual(profile.pageRules.chapter.defaultDenyOffsiteNavigation, true, "chapter rules should default-deny off-site navigation");
  assert.strictEqual(profile.pageRules.chapter.blockPopupOpenByDefault, true, "chapter rules should default-deny popup creation");
  assert(Array.isArray(profile.pageRules.chapter.popupAllowSameOriginPaths), "chapter rules should expose popup same-origin allowlist");
  assert(profile.pageRules.chapter.offsiteNavigationDenyHosts.includes("shopee.co.th"), "chapter rules should deny direct Shopee affiliate opens");
  assert(profile.pageRules.chapter.offsiteNavigationDenyHosts.includes("xm.com"), "chapter rules should deny direct XM affiliate opens");
  assert(profile.pageRules.chapter.offsiteNavigationDenyHosts.includes("chubbyexemplaryhardiness.com"), "chapter rules should deny chubby popup opens");
  assert(profile.pageRules.chapter.dynamicElementDenyHosts.includes("withagecomeswisdom.live"), "chapter rules should deny dynamic withage script/frame insertion");
  assert(profile.pageRules.chapter.dynamicElementDenyHosts.includes("weiledsteverm.org"), "chapter rules should deny dynamic weiledsteverm script/frame insertion");
  assert(profile.pageRules.chapter.dynamicElementDenyHosts.includes("ghabovethec.info"), "chapter rules should deny dynamic sister-host script/frame insertion");
  assert(profile.pageRules.chapter.blockedUrlTokens.includes("wbbcd=1246039"), "chapter rules should include final wbbcd loader token");
  assert(profile.pageRules.chapter.adBootstrapScriptUrls.some((url) => url.includes("withagecomeswisdom.live")), "chapter rules should include withage config endpoint");
  assert(profile.pageRules.chapter.offsiteNavigationDenyHosts.includes("clicks.pipaffiliates.com"), "chapter rules should deny affiliate click hosts");
  assert(profile.pageRules.chapter.affiliateHintHosts.includes("s.shopee.co.th"), "chapter rules should remove affiliate resource hints");
  assert(profile.pageRules.chapter.adBootstrapScriptUrls.some((url) => url.includes("d2dxy39sqorbhv.cloudfront.net")), "chapter rules should include final cloudfront loader");
  assert.strictEqual(profile.pageRules.chapter.clickShieldEnabled, true, "chapter click shield should be enabled");
  assert(profile.pageRules.chapter.clickShieldEvents.includes("pointerdown"), "chapter click shield should guard pointerdown");
  assert(profile.pageRules.chapter.clickShieldEvents.includes("mousedown"), "chapter click shield should guard mousedown");
  assert.strictEqual(profile.pageRules.chapter.shieldPlainChapterClicks, true, "chapter shield should cover plain chapter clicks");
  assert.strictEqual(profile.pageRules.chapter.safeNavigateFirstPartyAnchors, true, "chapter shield should safe-navigate first-party anchors");
  assert(profile.pageRules.chapter.orphanTextTerms.includes("content notification"), "chapter rules should include content notification cleanup");
  assert.strictEqual(await internals.hasProfileHostPermission(profile), true, "permission should be detected");
  assert.strictEqual(await internals.hasProfileHostPermission(mamtpoProfile), true, "Mamtpo permission should be detected");

  const activated = await internals.activateProfile("mangakakalot", false);
  assert.strictEqual(activated.activated, true, "profile should activate");
  const mamtpoActivated = await internals.activateProfile("mamtpo", false);
  assert.strictEqual(mamtpoActivated.activated, true, "Mamtpo profile should activate");

  const contentScript = registeredScripts.find((script) => script.id === "site-shield-content-mangakakalot");
  const pageGuard = registeredScripts.find((script) => script.id === "site-shield-page-guard-mangakakalot");
  const mamtpoContentScript = registeredScripts.find((script) => script.id === "site-shield-content-mamtpo");
  const mamtpoPageGuard = registeredScripts.find((script) => script.id === "site-shield-page-guard-mamtpo");
  assert(contentScript, "isolated content script should register");
  assert(pageGuard, "page guard should register");
  assert(mamtpoContentScript, "Mamtpo isolated content script should register");
  assert(mamtpoPageGuard, "Mamtpo page guard should register");
  assert(mamtpoContentScript.matches.includes("*://mamtpo.com/*"), "Mamtpo content script should match root host");
  assert(mamtpoContentScript.matches.includes("*://www.mamtpo.com/*"), "Mamtpo content script should match www host");
  assert.strictEqual(pageGuard.world, "MAIN", "page guard must run in MAIN world");
  assert(pageGuard.runAt === "document_start", "page guard should run at document_start");
  assert.strictEqual(pageGuard.allFrames, true, "page guard should run in all frames");
  assert.strictEqual(pageGuard.matchOriginAsFallback, true, "page guard should use origin fallback for inherited frames");

  const snapshot = await internals.buildDebugSnapshot("mangakakalot", "mangakakalot.gg");
  assert.strictEqual(snapshot.activeProfileId, "mangakakalot", "snapshot should include active profile");
  assert(snapshot.perf, "snapshot should include performance counters");
  assert(Array.isArray(snapshot.profileTuningSummary.hardBlockHosts), "snapshot should include hard hosts");
  assert(Array.isArray(snapshot.profileTuningSummary.candidateBlockHosts), "snapshot should include candidate hosts");

  await internals.deactivateProfile("mangakakalot");
  await internals.deactivateProfile("mamtpo");
  assert.strictEqual(registeredScripts.length, 0, "deactivation should unregister managed scripts");
  assert.strictEqual(dynamicRules.length, 0, "deactivation should remove stale managed dynamic rules");

  console.log("smoke ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
