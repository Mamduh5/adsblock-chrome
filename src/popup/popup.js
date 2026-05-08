(function runSiteShieldPopup() {
  "use strict";

  const elements = {
    siteStatus: document.getElementById("siteStatus"),
    profileName: document.getElementById("profileName"),
    profileId: document.getElementById("profileId"),
    profileSelect: document.getElementById("profileSelect"),
    knownProfiles: document.getElementById("knownProfiles"),
    globalEnabledToggle: document.getElementById("globalEnabledToggle"),
    profileEnabledToggle: document.getElementById("profileEnabledToggle"),
    debugToggle: document.getElementById("debugToggle"),
    inspectionToggle: document.getElementById("inspectionToggle"),
    customHosts: document.getElementById("customHosts"),
    customSelectors: document.getElementById("customSelectors"),
    saveButton: document.getElementById("saveButton"),
    scrubButton: document.getElementById("scrubButton"),
    resetButton: document.getElementById("resetButton"),
    copyDebugButton: document.getElementById("copyDebugButton"),
    message: document.getElementById("message"),
    blockedRequests: document.getElementById("blockedRequests"),
    removedOverlays: document.getElementById("removedOverlays"),
    blockedRedirects: document.getElementById("blockedRedirects"),
    deletedStorageItems: document.getElementById("deletedStorageItems"),
    perfSummary: document.getElementById("perfSummary"),
    recentEvents: document.getElementById("recentEvents")
  };

  let currentHost = "";
  let currentProfileId = "";

  document.addEventListener("DOMContentLoaded", initialize);
  elements.globalEnabledToggle.addEventListener("change", onGlobalEnabledChanged);
  elements.profileEnabledToggle.addEventListener("change", onProfileEnabledChanged);
  elements.debugToggle.addEventListener("change", onDebugChanged);
  elements.inspectionToggle.addEventListener("change", onInspectionChanged);
  elements.saveButton.addEventListener("click", onSave);
  elements.scrubButton.addEventListener("click", onScrub);
  elements.resetButton.addEventListener("click", onReset);
  elements.copyDebugButton.addEventListener("click", onCopyDebug);

  async function initialize() {
    const tab = await getActiveTab();
    currentHost = getHostname(tab && tab.url ? tab.url : "");
    await refreshState();
  }

  async function refreshState() {
    const state = await sendMessage({ type: "getPopupState", hostname: currentHost });

    if (!state || !state.ok) {
      setMessage("Unable to read extension state.");
      setScopedControls(false);
      return;
    }

    currentProfileId = state.profile ? state.profile.id : "";
    fillProfileSelect(state.profiles || []);
    renderKnownProfiles(state.profiles || []);

    elements.siteStatus.textContent = state.inScope
      ? "In scope: " + currentHost
      : "Out of scope. Add a known profile and grant host access to cover this site.";
    elements.profileName.textContent = state.profile ? state.profile.displayName : "None";
    elements.profileId.textContent = state.profile ? state.profile.id : "out-of-scope";
    elements.globalEnabledToggle.checked = Boolean(state.enabled);
    elements.debugToggle.checked = Boolean(state.debug);
    elements.inspectionToggle.checked = Boolean(state.inspectionMode);
    elements.profileEnabledToggle.checked = Boolean(state.settings && state.settings.enabled);
    elements.customHosts.value = state.settings ? (state.settings.customBlockedHosts || []).join("\n") : "";
    elements.customSelectors.value = state.settings ? (state.settings.customSelectors || []).join("\n") : "";
    setCounters(state.stats || {});
    renderPerf(state.perf || {});
    renderEvents(state.events || []);
    setScopedControls(Boolean(state.profile));
  }

  function fillProfileSelect(profileSummaries) {
    elements.profileSelect.textContent = "";
    for (const profile of profileSummaries) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.displayName + " (" + profile.id + ")";
      option.selected = profile.id === currentProfileId;
      elements.profileSelect.appendChild(option);
    }
  }

  function renderKnownProfiles(profileSummaries) {
    elements.knownProfiles.textContent = "";
    for (const profile of profileSummaries) {
      const row = document.createElement("div");
      row.className = "profile-row";

      const detail = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = profile.displayName;
      const meta = document.createElement("small");
      meta.textContent = [
        profile.id,
        profile.activated ? "activated" : "not activated",
        profile.permissionGranted ? "permission granted" : "permission missing"
      ].join(" | ");
      if (profile.unavailableReason) {
        meta.textContent += " | " + profile.unavailableReason;
      }
      detail.appendChild(title);
      detail.appendChild(meta);

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = profile.activated ? "Deactivate" : "Activate";
      button.addEventListener("click", () => {
        if (profile.activated) {
          deactivateProfile(profile.id);
        } else {
          activateProfile(profile);
        }
      });

      row.appendChild(detail);
      row.appendChild(button);
      elements.knownProfiles.appendChild(row);
    }
  }

  async function onGlobalEnabledChanged() {
    const response = await sendMessage({ type: "setGlobalEnabled", enabled: elements.globalEnabledToggle.checked });
    setMessage(response && response.ok ? "Global setting saved. Reload matched tabs to apply DOM changes." : "Unable to save setting.");
  }

  async function onProfileEnabledChanged() {
    if (!currentProfileId) {
      return;
    }
    const response = await sendMessage({
      type: "setProfileEnabled",
      profileId: currentProfileId,
      enabled: elements.profileEnabledToggle.checked
    });
    setMessage(response && response.ok ? "Profile setting saved. Reload matched tabs to apply DOM changes." : "Unable to save profile setting.");
  }

  async function activateProfile(profile) {
    let permissionGranted = profile.permissionGranted;
    if (!permissionGranted) {
      permissionGranted = await requestHostPermission(profile.hostPermissionPatterns || []);
    }
    const response = await sendMessage({
      type: "activateProfile",
      profileId: profile.id,
      requestPermission: false
    });

    if (response && response.ok && response.activated) {
      setMessage("Profile activated. Reload matching tabs to run registered scripts.");
    } else if (!permissionGranted || response && response.unavailableReason) {
      setMessage("Profile needs host permission before activation.");
    } else {
      setMessage("Unable to activate profile.");
    }
    await refreshState();
  }

  async function deactivateProfile(profileId) {
    const response = await sendMessage({ type: "deactivateProfile", profileId });
    setMessage(response && response.ok ? "Profile deactivated. Reload matching tabs to clear old page state." : "Unable to deactivate profile.");
    await refreshState();
  }

  async function onDebugChanged() {
    const response = await sendMessage({ type: "setDebug", debug: elements.debugToggle.checked });
    setMessage(response && response.ok ? "Debug setting saved." : "Unable to save debug setting.");
    await refreshState();
  }

  async function onInspectionChanged() {
    const response = await sendMessage({ type: "setInspectionMode", inspectionMode: elements.inspectionToggle.checked });
    setMessage(response && response.ok ? "Inspection mode saved. Browse and watch recent events." : "Unable to save inspection mode.");
    await refreshState();
  }

  async function onSave() {
    if (!currentProfileId) {
      setMessage("No matched profile for this tab.");
      return;
    }

    elements.saveButton.disabled = true;
    const hosts = splitLines(elements.customHosts.value);
    const selectors = splitLines(elements.customSelectors.value);
    const hostsResponse = await sendMessage({ type: "saveCustomHosts", profileId: currentProfileId, hosts });
    const selectorsResponse = await sendMessage({ type: "saveCustomSelectors", profileId: currentProfileId, selectors });
    elements.saveButton.disabled = false;

    if (hostsResponse && hostsResponse.ok && selectorsResponse && selectorsResponse.ok) {
      setMessage("Profile custom rules saved.");
    } else {
      setMessage("Unable to save one or more custom rules.");
    }
  }

  async function onScrub() {
    if (!currentProfileId) {
      setMessage("No matched profile for this tab.");
      return;
    }

    const response = await sendMessage({ type: "scrubCookiesNow", profileId: currentProfileId });
    if (response && response.ok) {
      setMessage("Cookie scrub checked " + response.result.checked + ", deleted " + response.result.deleted + ".");
      await refreshState();
    } else {
      setMessage("Cookie scrub failed.");
    }
  }

  async function onReset() {
    if (!currentProfileId) {
      setMessage("No matched profile for this tab.");
      return;
    }

    const response = await sendMessage({ type: "resetStats", profileId: currentProfileId });
    if (response && response.ok) {
      setCounters(response.stats || {});
      setMessage("Counts reset.");
    }
  }

  async function onCopyDebug() {
    const response = await sendMessage({
      type: "getDebugSnapshot",
      profileId: currentProfileId,
      hostname: currentHost
    });

    if (!response || !response.ok) {
      setMessage("Unable to build debug snapshot.");
      return;
    }

    const text = JSON.stringify(response.snapshot, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Debug snapshot copied.");
    } catch (error) {
      setMessage("Clipboard failed; snapshot logged to extension console.");
      console.info("[Site Shield] debug snapshot", response.snapshot);
    }
  }


  function setScopedControls(inScope) {
    elements.profileEnabledToggle.disabled = !inScope;
    elements.customHosts.disabled = !inScope;
    elements.customSelectors.disabled = !inScope;
    elements.saveButton.disabled = !inScope;
    elements.scrubButton.disabled = !inScope;
    elements.resetButton.disabled = !inScope;
    elements.copyDebugButton.disabled = !inScope;
  }

  function setCounters(stats) {
    elements.blockedRequests.textContent = String(stats.blockedRequests || 0);
    elements.removedOverlays.textContent = String(stats.removedOverlays || 0);
    elements.blockedRedirects.textContent = String(stats.blockedRedirects || 0);
    elements.deletedStorageItems.textContent = String(stats.deletedStorageItems || 0);
  }

  function renderEvents(events) {
    elements.recentEvents.textContent = "";
    for (const event of events.slice(0, 10)) {
      const item = document.createElement("li");
      const category = document.createElement("code");
      category.textContent = event.category;
      const action = document.createElement("strong");
      action.textContent = event.details && event.details.action || "event";
      item.appendChild(action);
      item.appendChild(category);
      item.appendChild(document.createTextNode(" " + event.summary));
      const context = eventContext(event);
      if (context) {
        item.appendChild(document.createElement("br"));
        item.appendChild(document.createTextNode(context));
      }
      elements.recentEvents.appendChild(item);
    }
  }

  function renderPerf(perf) {
    elements.perfSummary.textContent = "Perf: dom "
      + String(perf.domPasses || 0)
      + " passes, "
      + String(perf.skippedDomPasses || 0)
      + " skipped, "
      + String(perf.clicksShielded || 0)
      + " shielded clicks, "
      + String(perf.opensBlocked || 0)
      + " opens blocked, "
      + String(perf.orphanJunkRemoved || 0)
      + " orphan UI removed, "
      + String(perf.footerJunkGroupsRemoved || 0)
      + " footer groups removed, "
      + String(perf.popupLayersRemoved || 0)
      + " popups removed, "
      + String(perf.popupBackdropsNeutralized || 0)
      + " backdrops removed, "
      + String(perf.imageBlockPopupRemoved || 0)
      + " exact popups, "
      + String(perf.fullscreenOverlayRemoved || 0)
      + " exact overlays, "
      + String(perf.blockedAdBootstrapScripts || 0)
      + " boot scripts, "
      + String(perf.adContainerRemoved || 0)
      + " ad containers, "
      + String(perf.centeredPopupIframeRemoved || 0)
      + " centered iframes, "
      + String(perf.remainingBudgetKeysCleared || 0)
      + " budget keys, "
      + String(perf.floaterRequestBlocked || 0)
      + " floater blocked, "
      + String(perf.offsiteBlankPopupBlocked || 0)
      + " blank popups, "
      + String(perf.offsiteWindowOpenBlocked || 0)
      + " offsite opens, "
      + String(perf.offsiteTopNavigationBlocked || 0)
      + " offsite navs, "
      + String(perf.affiliateHostBlocked || 0)
      + " affiliate hits, "
      + String(perf.cloudfrontLoaderBlocked || 0)
      + " cloudfront loaders, "
      + String(perf.chubbyLoaderBlocked || 0)
      + " chubby loaders, "
      + String(perf.rearmedHijackAttemptsBlocked || 0)
      + " rearmed blocked, "
      + String(perf.eventsDropped || 0)
      + " dropped, "
      + String(perf.eventsCoalesced || 0)
      + " coalesced, "
      + String(perf.storageFlushes || 0)
      + " flushes";
  }

  function eventContext(event) {
    const details = event.details || {};
    return [
      details.requestHost || details.urlHost || "",
      details.selector || "",
      details.node || "",
      details.key || details.name || "",
      details.domain ? details.domain + (details.path || "") : "",
      details.url || "",
      event.pageHost || ""
    ].filter(Boolean).join(" | ").slice(0, 220);
  }

  function splitLines(value) {
    return String(value || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function setMessage(message) {
    elements.message.textContent = message;
  }

  function getActiveTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
    });
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => resolve(response));
    });
  }

  function requestHostPermission(origins) {
    return new Promise((resolve) => {
      chrome.permissions.request({ origins }, (granted) => resolve(Boolean(granted)));
    });
  }

  function getHostname(url) {
    try {
      return new URL(url).hostname;
    } catch (error) {
      return "";
    }
  }
})();
