(function runSiteShieldPopup() {
  "use strict";

  const elements = {
    siteStatus: document.getElementById("siteStatus"),
    profileName: document.getElementById("profileName"),
    profileId: document.getElementById("profileId"),
    profileSelect: document.getElementById("profileSelect"),
    globalEnabledToggle: document.getElementById("globalEnabledToggle"),
    profileEnabledToggle: document.getElementById("profileEnabledToggle"),
    debugToggle: document.getElementById("debugToggle"),
    customHosts: document.getElementById("customHosts"),
    customSelectors: document.getElementById("customSelectors"),
    saveButton: document.getElementById("saveButton"),
    scrubButton: document.getElementById("scrubButton"),
    resetButton: document.getElementById("resetButton"),
    message: document.getElementById("message"),
    blockedRequests: document.getElementById("blockedRequests"),
    removedOverlays: document.getElementById("removedOverlays"),
    blockedRedirects: document.getElementById("blockedRedirects"),
    deletedStorageItems: document.getElementById("deletedStorageItems"),
    recentEvents: document.getElementById("recentEvents")
  };

  let currentHost = "";
  let currentProfileId = "";

  document.addEventListener("DOMContentLoaded", initialize);
  elements.globalEnabledToggle.addEventListener("change", onGlobalEnabledChanged);
  elements.profileEnabledToggle.addEventListener("change", onProfileEnabledChanged);
  elements.debugToggle.addEventListener("change", onDebugChanged);
  elements.saveButton.addEventListener("click", onSave);
  elements.scrubButton.addEventListener("click", onScrub);
  elements.resetButton.addEventListener("click", onReset);

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

    elements.siteStatus.textContent = state.inScope
      ? "In scope: " + currentHost
      : "Out of scope. Add a profile and manifest host permission to cover this site.";
    elements.profileName.textContent = state.profile ? state.profile.displayName : "None";
    elements.profileId.textContent = state.profile ? state.profile.id : "out-of-scope";
    elements.globalEnabledToggle.checked = Boolean(state.enabled);
    elements.debugToggle.checked = Boolean(state.debug);
    elements.profileEnabledToggle.checked = Boolean(state.settings && state.settings.enabled);
    elements.customHosts.value = state.settings ? (state.settings.customBlockedHosts || []).join("\n") : "";
    elements.customSelectors.value = state.settings ? (state.settings.customSelectors || []).join("\n") : "";
    setCounters(state.stats || {});
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

  async function onDebugChanged() {
    const response = await sendMessage({ type: "setDebug", debug: elements.debugToggle.checked });
    setMessage(response && response.ok ? "Debug setting saved." : "Unable to save debug setting.");
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

  function setScopedControls(inScope) {
    elements.profileEnabledToggle.disabled = !inScope;
    elements.customHosts.disabled = !inScope;
    elements.customSelectors.disabled = !inScope;
    elements.saveButton.disabled = !inScope;
    elements.scrubButton.disabled = !inScope;
    elements.resetButton.disabled = !inScope;
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
      item.appendChild(category);
      item.appendChild(document.createTextNode(" " + event.summary));
      elements.recentEvents.appendChild(item);
    }
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

  function getHostname(url) {
    try {
      return new URL(url).hostname;
    } catch (error) {
      return "";
    }
  }
})();
