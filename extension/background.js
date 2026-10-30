// AURA-MEET Background Service Worker (Manifest V3)
// Owns the session lifecycle: meeting detected -> recording (one backend session per meeting) -> finished -> processing.
// State lives in chrome.storage.session because the service worker can be suspended at any time.

const BACKEND = "http://localhost:8000";
const OFFSCREEN_PATH = "offscreen.html";
const DEFAULT_SETTINGS = { autoRecord: true, autoStop: true };

// ----------------- State -----------------
async function getState() {
  const { auraState } = await chrome.storage.session.get("auraState");
  return auraState || { recording: null, detected: {}, lastSession: null, lastError: null };
}

async function setState(mutator) {
  const state = await getState();
  mutator(state);
  await chrome.storage.session.set({ auraState: state });
  broadcastState(state);
  return state;
}

async function getSettings() {
  const { auraSettings } = await chrome.storage.local.get("auraSettings");
  return { ...DEFAULT_SETTINGS, ...(auraSettings || {}) };
}

function broadcastState(state) {
  chrome.runtime.sendMessage({ type: "SESSION_STATE", state }).catch(() => {});
  const tabIds = new Set(Object.keys(state.detected).map(Number));
  if (state.recording) tabIds.add(state.recording.tabId);
  for (const tabId of tabIds) {
    chrome.tabs.sendMessage(tabId, { type: "SESSION_STATE", state, tabId }).catch(() => {});
  }
  updateBadge(state);
}

function updateBadge(state) {
  if (state.recording) {
    chrome.action.setBadgeBackgroundColor({ color: "#E11D48" });
    chrome.action.setBadgeText({ text: "REC" });
    chrome.action.setTitle({ title: `AURA-MEET — recording "${state.recording.title}"` });
  } else if (Object.keys(state.detected).length) {
    chrome.action.setBadgeBackgroundColor({ color: "#FF7F50" });
    chrome.action.setBadgeText({ text: "●" });
    chrome.action.setTitle({ title: "AURA-MEET — meeting detected. Click to record." });
  } else {
    chrome.action.setBadgeText({ text: "" });
    chrome.action.setTitle({ title: "AURA-MEET — open copilot" });
  }
}

// ----------------- Toolbar & shortcut -----------------
// Clicking the toolbar icon opens the side panel. It also grants activeTab, which tab audio capture requires.
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {});

chrome.action.onClicked.addListener(async (tab) => {
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  await chrome.storage.session.set({ invokedTabId: tab.id });
  // If a meeting is running in this tab and auto-record is on, the click is all it takes.
  const [state, settings] = await Promise.all([getState(), getSettings()]);
  if (!state.recording && state.detected[tab.id] && settings.autoRecord) {
    startRecording(tab.id, "toolbar");
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "toggle-recording" || !tab) return;
  const state = await getState();
  if (state.recording) {
    stopRecording("shortcut");
  } else {
    startRecording(tab.id, "shortcut");
  }
});

// ----------------- Tab lifecycle -----------------
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getState();
  if (state.recording && state.recording.tabId === tabId) {
    await stopRecording("tab-closed");
  }
  if (state.detected[tabId]) {
    await setState((s) => { delete s.detected[tabId]; });
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const state = await getState();
  if (state.recording && state.recording.tabId === tabId && !isMeetingUrl(changeInfo.url)) {
    await stopRecording("navigated-away");
  }
});

function isMeetingUrl(url) {
  return /^https:\/\/(meet\.google\.com|[\w.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)\//.test(url || "");
}

// ----------------- Messages -----------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === "offscreen") return false;

  const handlers = {
    GET_STATE: async () => ({ state: await getState(), settings: await getSettings(), tabId: sender.tab?.id }),
    MEETING_STATE: () => handleMeetingState(message, sender.tab),
    START_RECORDING: async () => {
      const tabId = message.tabId || sender.tab?.id || (await activeTabId());
      return startRecording(tabId, message.source || "ui", message.title);
    },
    STOP_RECORDING: () => stopRecording(message.reason || "ui"),
    UPDATE_SETTINGS: async () => {
      const settings = { ...(await getSettings()), ...(message.settings || {}) };
      await chrome.storage.local.set({ auraSettings: settings });
      return { settings };
    },
    RENAME_SESSION: async () => {
      await setState((s) => { if (s.recording) s.recording.title = message.title; });
      return { ok: true };
    },
    OPEN_SIDEPANEL: async () => {
      if (sender.tab) await chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
      return { ok: true };
    },
    OPEN_URL: async () => {
      await chrome.tabs.create({ url: message.url });
      return { ok: true };
    },
    CAPTURE_ERROR: async () => {
      // Offscreen lost a stream mid-meeting
      await setState((s) => { s.lastError = message.error; });
      return { ok: true };
    },
    MIC_PERMISSION_GRANTED: async () => {
      const st = await getState();
      if (!st.recording || st.recording.micOk) return { ok: true };
      const res = await chrome.runtime.sendMessage({ target: "offscreen", type: "ADD_MIC" }).catch(() => ({ ok: false }));
      if (res?.ok) {
        await setState((s) => {
          if (s.recording) s.recording.micOk = true;
          s.lastError = null;
        });
      }
      return { ok: Boolean(res?.ok) };
    },
    CLEAR_ERROR: async () => {
      await setState((s) => { s.lastError = null; });
      return { ok: true };
    },
  };

  const handler = handlers[message.type];
  if (!handler) return false;
  Promise.resolve(handler())
    .then((res) => sendResponse(res))
    .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
  return true;
});

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id;
}

async function handleMeetingState(message, tab) {
  if (!tab) return { ok: false };
  const tabId = tab.id;
  const state = await getState();
  const wasDetected = Boolean(state.detected[tabId]);

  if (message.inCall) {
    await setState((s) => {
      s.detected[tabId] = {
        platform: message.platform,
        title: message.title,
        url: message.url,
        since: s.detected[tabId]?.since || Date.now(),
      };
      if (s.recording && s.recording.tabId === tabId && message.title && s.recording.autoTitle) {
        s.recording.title = message.title;
      }
    });
    if (!wasDetected && !state.recording) {
      const settings = await getSettings();
      if (settings.autoRecord) {
        // Works when the user has already clicked the AURA icon on this tab; otherwise the page shows a one-click prompt.
        const res = await startRecording(tabId, "auto");
        return { ok: true, autoStarted: res.ok, needsInvocation: res.needsInvocation };
      }
    }
    return { ok: true };
  }

  // Meeting ended in this tab
  if (wasDetected) {
    await setState((s) => { delete s.detected[tabId]; });
  }
  if (state.recording && state.recording.tabId === tabId && (await getSettings()).autoStop) {
    await stopRecording("meeting-ended");
  }
  return { ok: true };
}

// ----------------- Recording -----------------
let transition = null; // serializes start/stop so double clicks can't create two sessions

async function startRecording(tabId, source, titleOverride) {
  if (transition) await transition.catch(() => {});
  transition = doStart(tabId, source, titleOverride);
  try {
    return await transition;
  } finally {
    transition = null;
  }
}

async function doStart(tabId, source, titleOverride) {
  const state = await getState();
  if (state.recording) {
    return state.recording.tabId === tabId
      ? { ok: true, already: true, recording: state.recording }
      : { ok: false, error: `Already recording "${state.recording.title}" in another tab. Stop it first.` };
  }
  if (!tabId) return { ok: false, error: "No tab to record." };

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return { ok: false, error: "That tab is gone." };
  const detected = state.detected[tabId];
  const platform = detected?.platform || platformFromUrl(tab.url);
  const title = titleOverride || detected?.title || defaultTitle(platform);

  // 1. Tab audio stream id (requires the extension to have been invoked on this tab)
  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  } catch (err) {
    const msg = err.message || String(err);
    const needsInvocation = /invoked|activeTab|permission/i.test(msg);
    const error = needsInvocation
      ? "Click the AURA icon in the toolbar (or press ⌥⇧R) once to allow recording this tab."
      : `Could not capture tab audio: ${msg}`;
    if (source !== "auto") await setState((s) => { s.lastError = error; });
    return { ok: false, needsInvocation, error };
  }

  // 2. A new backend session for this meeting
  let meeting;
  try {
    const res = await fetch(`${BACKEND}/api/meetings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, platform, meeting_url: tab.url, attendees: [], status: "recording" }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    meeting = await res.json();
  } catch (err) {
    const error = "AURA backend is offline. Run ./start.sh, then try again.";
    await setState((s) => { s.lastError = error; });
    return { ok: false, error };
  }

  // 3. Start capture in the offscreen document
  await ensureOffscreen();
  const capture = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "START_CAPTURE",
    data: { meetingId: meeting.id, streamId },
  }).catch((err) => ({ ok: false, error: err.message }));

  if (!capture?.ok) {
    await fetch(`${BACKEND}/api/meetings/${meeting.id}`, { method: "DELETE" }).catch(() => {});
    const error = `Could not start audio capture: ${capture?.error || "unknown error"}`;
    await setState((s) => { s.lastError = error; });
    return { ok: false, error };
  }

  if (!capture.micOk) {
    // Extension pages can't prompt from the offscreen document; ask once in a normal tab.
    chrome.tabs.create({ url: chrome.runtime.getURL("permission.html"), active: true });
  }

  const recording = {
    meetingId: meeting.id,
    tabId,
    title,
    autoTitle: !titleOverride,
    platform,
    startedAt: Date.now(),
    micOk: capture.micOk,
    tabOk: capture.tabOk,
  };
  await setState((s) => {
    s.recording = recording;
    s.lastError = capture.micOk ? null : "Microphone not available — recording meeting audio only. Grant mic access in the tab that just opened.";
  });
  return { ok: true, recording };
}

async function stopRecording(reason) {
  if (transition) await transition.catch(() => {});
  transition = doStop(reason);
  try {
    return await transition;
  } finally {
    transition = null;
  }
}

async function doStop(reason) {
  const state = await getState();
  const recording = state.recording;
  if (!recording) return { ok: true, idle: true };

  const result = await chrome.runtime.sendMessage({ target: "offscreen", type: "STOP_CAPTURE" })
    .catch((err) => ({ ok: false, error: err.message }));
  await closeOffscreen();

  let finish = { status: "recorded" };
  try {
    const res = await fetch(`${BACKEND}/api/meetings/${recording.meetingId}/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auto_process: true }),
    });
    finish = await res.json();
  } catch (err) {
    finish = { status: "error", error: "Backend offline — open the dashboard later and click Process." };
  }

  await setState((s) => {
    s.recording = null;
    s.lastSession = {
      meetingId: recording.meetingId,
      title: recording.title,
      endedAt: Date.now(),
      reason,
      status: finish.status,
    };
    if (!result?.ok && result?.error) s.lastError = `Recording stopped with a problem: ${result.error}`;
  });
  return { ok: true, meetingId: recording.meetingId, finish };
}

// ----------------- Offscreen document -----------------
async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
    justification: "Records the meeting tab and microphone into a single session stream.",
  });
}

async function closeOffscreen() {
  try {
    await chrome.offscreen.closeDocument();
  } catch (e) {}
}

// ----------------- Helpers -----------------
function platformFromUrl(url = "") {
  if (url.includes("meet.google.com")) return "meet";
  if (url.includes("zoom.us")) return "zoom";
  if (url.includes("teams.")) return "teams";
  return "browser";
}

function defaultTitle(platform) {
  const names = { meet: "Google Meet", zoom: "Zoom", teams: "Teams", browser: "Browser" };
  const when = new Date().toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `${names[platform] || "Meeting"} · ${when}`;
}

// Restore the badge after the worker wakes up
getState().then(updateBadge);
