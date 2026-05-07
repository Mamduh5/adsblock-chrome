(function runSiteShieldPopup() {
  "use strict";

  const elements = {
    siteStatus: document.getElementById("siteStatus"),
    enabledToggle: document.getElementById("enabledToggle"),
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
    deletedStorageItems: document.getElementById("deletedStorageItems")
  };

  let currentHost = "";

  document.addEventListener("DOMContentLoaded", initialize);
  elements.enabledToggle.addEventListener("change", onEnabledChanged);
  elements.debugToggle.addEventListener("change", onDebugChanged);
  elements.saveButton.addEventListener("click", onSave);
  elements.scrubButton.addEventListener("click", onScrub);
  elements.resetButton.addEventListener("click", onReset);

  async function initialize() {
    const tab = await getActiveTab();
    currentHost = getHostname(tab && tab.url ? tab.url : "");
    const state = await sendMessage({ type: "getPopupState", hostname: currentHost });

    if (!state || !state.ok) {
      setMessage("Unable to read extension state.");
      return;
    }

    elements.siteStatus.textContent = state.target
      ? "Active scope: " + currentHost
      : "Inactive on this site. Target scope is example.com.";

    elements.enabledToggle.checked = Boolean(state.enabled);
    elements.debugToggle.checked = Boolean(state.debug);
    elements.customHosts.value = (state.settings.customBlockedHosts || []).join("\n");
    elements.customSelectors.value = (state.settings.customSelectors || []).join("\n");
    setCounters(state.stats || {});
  }

  async function onEnabledChanged() {
    const response = await sendMessage({ type: "setEnabled", enabled: elements.enabledToggle.checked });
    setMessage(response && response.ok ? "Setting saved. Reload target tabs to apply DOM changes." : "Unable to save setting.");
  }

  async function onDebugChanged() {
    const response = await sendMessage({ type: "setDebug", debug: elements.debugToggle.checked });
    setMessage(response && response.ok ? "Debug setting saved." : "Unable to save debug setting.");
  }

  async function onSave() {
    elements.saveButton.disabled = true;
    const hosts = splitLines(elements.customHosts.value);
    const selectors = splitLines(elements.customSelectors.value);
    const hostsResponse = await sendMessage({ type: "saveCustomHosts", hosts });
    const selectorsResponse = await sendMessage({ type: "saveCustomSelectors", selectors });
    elements.saveButton.disabled = false;

    if (hostsResponse && hostsResponse.ok && selectorsResponse && selectorsResponse.ok) {
      setMessage("Custom rules saved.");
    } else {
      setMessage("Unable to save one or more custom rules.");
    }
  }

  async function onScrub() {
    const response = await sendMessage({ type: "scrubCookiesNow" });
    if (response && response.ok) {
      setMessage("Cookie scrub checked " + response.result.checked + ", deleted " + response.result.deleted + ".");
    } else {
      setMessage("Cookie scrub failed.");
    }
  }

  async function onReset() {
    const response = await sendMessage({ type: "resetStats", hostname: currentHost });
    if (response && response.ok) {
      setCounters(response.stats || {});
      setMessage("Counts reset.");
    }
  }

  function setCounters(stats) {
    elements.blockedRequests.textContent = String(stats.blockedRequests || 0);
    elements.removedOverlays.textContent = String(stats.removedOverlays || 0);
    elements.blockedRedirects.textContent = String(stats.blockedRedirects || 0);
    elements.deletedStorageItems.textContent = String(stats.deletedStorageItems || 0);
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
