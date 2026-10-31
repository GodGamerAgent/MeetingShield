// Quorum background service worker (Manifest V3)
// Manual recording only: you start a session (side panel, ⌥⇧R, or right-click the toolbar icon),
// it records the tab + your mic as one backend session, and you stop it when the meeting is over.
// State lives in chrome.storage.session because the service worker can be suspended at any time.

const BACKEND = "http://localhost:8000";
const WS_LIVE = "ws://localhost:8000/ws/live";
const DASHBOARD = "http://localhost:3001";
const OFFSCREEN_PATH = "offscreen.html";
const DEFAULT_SETTINGS = { autoProcess: true };

// ----------------- State -----------------
async function getState() {
  const { quorumState } = await chrome.storage.session.get("quorumState");
  return quorumState || { recording: null, lastSession: null, lastError: null, pendingSession: null };
}

async function setState(mutator) {
  const state = await getState();
  mutator(state);
  await chrome.storage.session.set({ quorumState: state });
  chrome.runtime.sendMessage({ type: "SESSION_STATE", state }).catch(() => {});
  updateBadge(state);
  return state;
}

function updateBadge(state) {
  if (state.recording) {
    chrome.action.setBadgeBackgroundColor({ color: "#E11D48" });
    chrome.action.setBadgeText({ text: "REC" });
    chrome.action.setTitle({ title: `Quorum — recording "${state.recording.title}"` });
  } else {
    chrome.action.setBadgeText({ text: "" });
    chrome.action.setTitle({ title: "Quorum — open the recorder" });
  }
}

// ----------------- Settings (shared with the dashboard via the backend) -----------------
async function cacheSettings(partial) {
  const { quorumSettings } = await chrome.storage.local.get("quorumSettings");
  const settings = { ...DEFAULT_SETTINGS, ...(quorumSettings || {}), ...partial };
  await chrome.storage.local.set({ quorumSettings: settings });
  return settings;
}

function settingsFromBackend(cfg) {
  return typeof cfg?.auto_process_enabled === "boolean" ? { autoProcess: cfg.auto_process_enabled } : {};
}

async function getSettings() {
  try {
    const res = await fetchWithTimeout(`${BACKEND}/api/settings`, {}, 1500);
    if (res.ok) return cacheSettings(settingsFromBackend(await res.json()));
  } catch (e) {}
  return cacheSettings({});
}

async function saveSettings(partial) {
  if (typeof partial?.autoProcess === "boolean") {
    await fetch(`${BACKEND}/api/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auto_process_enabled: partial.autoProcess }),
    }).catch(() => {});
  }
  return cacheSettings(partial);
}

function fetchWithTimeout(url, options = {}, ms = 3000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

// ----------------- Toolbar, shortcut & menu -----------------
// Clicking the icon opens the side panel. It also grants activeTab, which Chrome requires for tab audio capture.
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {});

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "toggle-recording" || !tab) return;
  const state = await getState();
  if (state.recording) stopRecording("shortcut");
  else startRecording(tab.id);
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "quorum-toggle-recording", title: "Start / stop recording this tab", contexts: ["action"] });
    chrome.contextMenus.create({ id: "quorum-session-settings", title: "Session settings…", contexts: ["action"] });
    chrome.contextMenus.create({ id: "quorum-open-dashboard", title: "Open dashboard", contexts: ["action"] });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "quorum-session-settings" && tab) {
    chrome.sidePanel.open({ tabId: tab.id }).catch(() => {}); // must run inside the click gesture
    await chrome.storage.session.set({ openView: "settings" });
    chrome.runtime.sendMessage({ type: "OPEN_VIEW", view: "settings" }).catch(() => {});
  } else if (info.menuItemId === "quorum-toggle-recording" && tab) {
    const state = await getState();
    if (state.recording) stopRecording("menu");
    else startRecording(tab.id);
  } else if (info.menuItemId === "quorum-open-dashboard") {
    chrome.tabs.create({ url: DASHBOARD });
  }
});

// Closing the recorded tab ends its audio, so finish the session cleanly
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getState();
  if (state.recording && state.recording.tabId === tabId) await stopRecording("tab-closed");
});

// ----------------- Messages -----------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === "offscreen") return false;

  const handlers = {
    GET_STATE: async () => ({ state: await getState(), settings: await getSettings() }),
    START_RECORDING: async () => startRecording(message.tabId || sender.tab?.id || (await activeTabId())),
    STOP_RECORDING: () => stopRecording(message.reason || "ui"),
    UPDATE_SETTINGS: async () => ({ settings: await saveSettings(message.settings) }),
    SETTINGS_CHANGED: async () => ({ settings: await cacheSettings(settingsFromBackend(message.settings)) }),
    SET_SESSION_DETAILS: () => setSessionDetails(message.details || {}),
    DISCARD_RECORDING: () => discardRecording(message.reason || "Session deleted from the dashboard — recording stopped."),
    RENAME_SESSION: async () => {
      await setState((s) => { if (s.recording) s.recording.title = message.title; });
      return { ok: true };
    },
    OPEN_URL: async () => {
      await chrome.tabs.create({ url: message.url });
      return { ok: true };
    },
    CAPTURE_ERROR: async () => {
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

// ----------------- Recording -----------------
let transition = null; // serializes start/stop so double clicks can't create two sessions

async function startRecording(tabId) {
  if (transition) await transition.catch(() => {});
  transition = doStart(tabId);
  try {
    return await transition;
  } finally {
    transition = null;
  }
}

async function doStart(tabId) {
  const state = await getState();
  if (state.recording) {
    return state.recording.tabId === tabId
      ? { ok: true, already: true, recording: state.recording }
      : { ok: false, error: `Already recording "${state.recording.title}" in another tab. Stop it first.` };
  }
  if (!tabId) return { ok: false, error: "No tab to record." };

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return { ok: false, error: "That tab is gone." };

  const pending = state.pendingSession || {};
  const platform = platformFromUrl(tab.url);
  const title = pending.title || defaultTitle(platform, tab.title);

  // 1. Tab audio (Chrome only allows this after you clicked Quorum on this tab, or used its shortcut)
  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  } catch (err) {
    const msg = err.message || String(err);
    const error = /invoked|activeTab|permission/i.test(msg)
      ? "Click the Quorum icon on the meeting tab (or press ⌥⇧R there), then start recording."
      : `Could not capture tab audio: ${msg}`;
    await setState((s) => { s.lastError = error; });
    return { ok: false, error };
  }

  // 2. A new backend session for this meeting
  let meeting;
  try {
    const res = await fetch(`${BACKEND}/api/meetings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        agenda: pending.agenda || "",
        attendees: pending.attendees || [],
        platform,
        meeting_url: tab.url,
        status: "recording",
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    meeting = await res.json();
  } catch (err) {
    const error = "Quorum backend is offline. Run ./start.sh, then try again.";
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
    await closeOffscreen();
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
    platform,
    startedAt: Date.now(),
    micOk: capture.micOk,
    tabOk: capture.tabOk,
  };
  await setState((s) => {
    s.recording = recording;
    s.pendingSession = null;
    s.lastError = capture.micOk ? null : "Microphone not available — recording meeting audio only. Grant mic access in the tab that just opened.";
  });
  connectLive();
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
      body: JSON.stringify({}), // backend applies the shared "process after recording" setting
    });
    finish = await res.json();
  } catch (err) {
    finish = { status: "error", error: "Backend offline — open the dashboard later and click Process." };
  }

  disconnectLive();
  await setState((s) => {
    s.recording = null;
    s.lastSession = { meetingId: recording.meetingId, title: recording.title, endedAt: Date.now(), reason, status: finish.status };
    if (!result?.ok && result?.error) s.lastError = `Recording stopped with a problem: ${result.error}`;
  });
  return { ok: true, meetingId: recording.meetingId, finish };
}

// Session details from the side panel: edit the live session, or queue them for the next recording
async function setSessionDetails(details) {
  const clean = {
    title: (details.title || "").trim(),
    agenda: (details.agenda || "").trim(),
    attendees: (details.attendees || []).map((a) => a.trim()).filter(Boolean),
  };
  const state = await getState();
  if (state.recording) {
    const res = await fetch(`${BACKEND}/api/meetings/${state.recording.meetingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...(clean.title ? { title: clean.title } : {}), agenda: clean.agenda, attendees: clean.attendees }),
    }).catch(() => null);
    if (!res?.ok) return { ok: false, error: "Backend offline — details not saved." };
    await setState((s) => { if (s.recording && clean.title) s.recording.title = clean.title; });
    return { ok: true, applied: "current" };
  }
  await setState((s) => { s.pendingSession = clean.title || clean.agenda || clean.attendees.length ? clean : null; });
  return { ok: true, applied: "next" };
}

// The session was deleted on the dashboard while recording: stop capturing and drop it
async function discardRecording(reason) {
  const state = await getState();
  if (!state.recording) return { ok: true };
  await chrome.runtime.sendMessage({ target: "offscreen", type: "STOP_CAPTURE" }).catch(() => {});
  await closeOffscreen();
  disconnectLive();
  await setState((s) => {
    s.recording = null;
    s.lastSession = null;
    s.lastError = reason;
  });
  return { ok: true };
}

// ----------------- Live sync with the backend (while recording) -----------------
// An open socket with regular traffic also keeps this service worker awake during the meeting.
let liveSocket = null;
let livePing = null;

function connectLive() {
  if (liveSocket && liveSocket.readyState <= WebSocket.OPEN) return;
  try {
    liveSocket = new WebSocket(WS_LIVE);
  } catch (e) {
    return;
  }
  liveSocket.onopen = () => {
    clearInterval(livePing);
    livePing = setInterval(() => liveSocket?.readyState === WebSocket.OPEN && liveSocket.send("ping"), 20000);
  };
  liveSocket.onmessage = async (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch (e) { return; }
    const state = await getState();
    if (msg.type === "SETTINGS_UPDATED") {
      await cacheSettings(settingsFromBackend(msg.settings));
    } else if (msg.type === "MEETING_UPDATED" && state.recording?.meetingId === msg.meeting_id && msg.meeting?.title
               && msg.meeting.title !== state.recording.title) {
      await setState((s) => { if (s.recording) s.recording.title = msg.meeting.title; });
    } else if ((msg.type === "MEETING_DELETED" && state.recording?.meetingId === msg.meeting_id) || (msg.type === "SESSIONS_CLEARED" && state.recording)) {
      await discardRecording("Session deleted from the dashboard — recording stopped.");
    }
  };
  liveSocket.onclose = async () => {
    clearInterval(livePing);
    liveSocket = null;
    if ((await getState()).recording) setTimeout(connectLive, 3000);
  };
}

function disconnectLive() {
  clearInterval(livePing);
  if (liveSocket) {
    liveSocket.onclose = null;
    liveSocket.close();
    liveSocket = null;
  }
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

function defaultTitle(platform, tabTitle) {
  const names = { meet: "Google Meet", zoom: "Zoom", teams: "Teams" };
  const when = new Date().toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const base = names[platform] || (tabTitle || "").trim().slice(0, 60) || "Meeting";
  return `${base} · ${when}`;
}

// After the worker wakes up: restore the badge and resume live sync
getState().then((state) => {
  updateBadge(state);
  if (state.recording) connectLive();
});
