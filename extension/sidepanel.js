// Quorum side panel: start/stop recording, notes, sessions, Q&A and session settings.
// Recording itself lives in the background worker + offscreen document, so closing this panel never stops it.

const BACKEND = "http://localhost:8000";
const WS_LIVE = "ws://localhost:8000/ws/live";
const DASHBOARD = "http://localhost:3001";

const $ = (id) => document.getElementById(id);
const nowCard = $("now-card");

let state = { recording: null, lastSession: null, lastError: null, pendingSession: null };
let activeTabId = null;
let meetings = [];
const progress = {}; // meetingId -> {progress, message, status}
let timerInterval = null;
let notesMeetingId = null;
let notesTimer = null;
let notesDirty = false;
let settings = {};
let config = {};
let sessionFormDirty = false;

// ----------------- Boot -----------------
document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  await refreshActiveTab();
  const res = await chrome.runtime.sendMessage({ type: "GET_STATE" }).catch(() => null);
  if (res) {
    state = res.state;
    applySettings(res.settings);
  }
  render();
  const { openView } = await chrome.storage.session.get("openView").catch(() => ({}));
  if (openView) showView(openView);
  checkBackend();
  setInterval(checkBackend, 10000);
  loadSessions();
  connectLive();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "SESSION_STATE") {
    const wasRecording = state.recording?.meetingId;
    state = message.state;
    render();
    if (wasRecording !== state.recording?.meetingId) loadSessions();
  } else if (message.type === "OPEN_VIEW") {
    showView(message.view);
  } else if (message.type === "LEVELS" && state.recording?.meetingId === message.meetingId) {
    $("mic-meter").style.width = `${Math.round(message.mic * 100)}%`;
    $("tab-meter").style.width = `${Math.round(message.tab * 100)}%`;
  }
});

chrome.tabs.onActivated.addListener(async () => { await refreshActiveTab(); render(); });
chrome.windows?.onFocusChanged?.addListener(async () => { await refreshActiveTab(); render(); });

async function refreshActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  activeTabId = tab?.id ?? null;
}

// ----------------- Rendering -----------------
function render() {
  const rec = state.recording;
  const view = rec ? "recording" : "idle";
  nowCard.dataset.state = view;

  clearInterval(timerInterval);
  if (rec) {
    const tick = () => { $("rec-timer").textContent = fmtDuration((Date.now() - rec.startedAt) / 1000); };
    tick();
    timerInterval = setInterval(tick, 1000);
    if (document.activeElement !== $("rec-title")) $("rec-title").value = rec.title;
    document.querySelector(".meter:nth-child(1)").classList.toggle("off", !rec.micOk);
    document.querySelector(".meter:nth-child(2)").classList.toggle("off", !rec.tabOk);
  } else {
    $("start-btn").textContent = state.pendingSession?.title
      ? `● Start recording “${state.pendingSession.title}”`
      : "● Start recording this tab";
  }

  // Alert
  if (state.lastError) {
    $("alert-text").textContent = state.lastError;
    $("alert").hidden = false;
  } else {
    $("alert").hidden = true;
  }

  if (!sessionFormDirty) fillSessionForm();

  // Notes follow the live session, else the one that just ended
  const target = rec?.meetingId || state.lastSession?.meetingId || null;
  if (target !== notesMeetingId) switchNotes(target);
}

function renderSessions() {
  const list = $("sessions");
  list.innerHTML = "";
  if (!meetings.length) {
    list.innerHTML = '<li class="muted small empty">No sessions yet. Your first recorded meeting will appear here.</li>';
    return;
  }
  for (const m of meetings.slice(0, 8)) {
    const p = progress[m.id];
    const status = p?.status === "processing" ? "processing" : m.status;
    const li = document.createElement("li");
    li.className = "session";
    li.innerHTML = `
      <span class="session-title"></span>
      <span class="pill ${pillClass(status)}">${pillText(status, p)}</span>
      <span class="session-meta"></span>
      ${status === "processing" ? `<div class="progress"><div style="width:${p?.progress || 5}%"></div></div>` : ""}
    `;
    li.querySelector(".session-title").textContent = m.title;
    li.querySelector(".session-meta").textContent = `${fmtDate(m.created_at)}${m.duration_sec ? " · " + fmtDuration(m.duration_sec) : ""}`;
    li.title = status === "error" && m.processing_error ? m.processing_error : "Open in dashboard";
    li.addEventListener("click", () => chrome.tabs.create({ url: `${DASHBOARD}/meetings/${m.id}` }));
    list.appendChild(li);
  }
  renderChatSessions();
}

function renderChatSessions() {
  const select = $("chat-session");
  const prev = select.value;
  const ready = meetings.filter((m) => m.status === "completed");
  select.innerHTML = ready.length
    ? ready.map((m) => `<option value="${m.id}">${escapeHtml(m.title)} — ${fmtDate(m.created_at)}</option>`).join("")
    : '<option value="">No processed sessions yet</option>';
  if (ready.some((m) => m.id === prev)) select.value = prev;
}

function pillClass(status) {
  return { recording: "recording", processing: "processing", completed: "completed", error: "error" }[status] || "";
}

function pillText(status, p) {
  if (status === "processing") return `Processing ${p?.progress ? p.progress + "%" : "…"}`;
  return { recording: "● Recording", completed: "Ready", error: "Failed", recorded: "Not processed" }[status] || status;
}

// ----------------- Backend -----------------
async function checkBackend() {
  const el = $("backend-status");
  const text = el.querySelector(".status-text");
  try {
    const res = await fetch(`${BACKEND}/api/status`);
    const data = await res.json();
    el.classList.remove("degraded");
    el.classList.add("online");
    if (data.lm_studio?.online) {
      text.textContent = `AI ready · ${data.lm_studio.latency_ms}ms`;
      el.title = data.lm_studio.message;
    } else {
      el.classList.add("degraded");
      text.textContent = "LM Studio offline";
      el.title = "Recording and transcription work. Summaries wait until LM Studio is running.";
    }
  } catch (e) {
    el.classList.remove("online", "degraded");
    text.textContent = "Backend offline";
    el.title = "Start the backend with ./start.sh";
  }
}

async function loadSessions() {
  try {
    const res = await fetch(`${BACKEND}/api/meetings`);
    meetings = await res.json();
    renderSessions();
  } catch (e) {
    $("sessions").innerHTML = '<li class="muted small empty">Backend offline — sessions will appear when it is running.</li>';
  }
}

let reloadTimer = null;
function scheduleSessionsReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(loadSessions, 400);
}

function connectLive() {
  let ws;
  try {
    ws = new WebSocket(WS_LIVE);
  } catch (e) {
    setTimeout(connectLive, 4000);
    return;
  }
  ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch (e) { return; }
    if (msg.type === "PROCESSING_PROGRESS") {
      progress[msg.meeting_id] = { status: "processing", progress: msg.progress, message: msg.message };
      renderSessions();
    } else if (msg.type === "MEETING_PROCESSED" || msg.type === "PROCESSING_ERROR") {
      delete progress[msg.meeting_id];
      scheduleSessionsReload();
    } else if (["RECORDING_STARTED", "RECORDING_STOPPED", "MEETING_CREATED", "MEETING_UPDATED", "MEETING_DELETED", "SESSIONS_CLEARED"].includes(msg.type)) {
      scheduleSessionsReload();
      if (msg.type === "MEETING_UPDATED" && msg.meeting_id === state.recording?.meetingId && !sessionFormDirty) {
        fillSessionForm(msg.meeting);
      }
    } else if (msg.type === "SETTINGS_UPDATED") {
      // Changed on the dashboard (or in another window)
      chrome.runtime.sendMessage({ type: "SETTINGS_CHANGED", settings: msg.settings }).then((r) => applySettings(r?.settings)).catch(() => {});
      applyConfig(msg.settings);
    } else if (msg.type === "NOTES_UPDATED" && msg.meeting_id === notesMeetingId && msg.source !== "extension" && !notesDirty) {
      $("notes").value = msg.raw_notes || "";
      $("notes-status").textContent = "Updated from dashboard";
    }
  };
  ws.onclose = () => setTimeout(connectLive, 3000);
}

// ----------------- Notes -----------------
async function switchNotes(meetingId) {
  if (notesDirty && notesMeetingId) await saveNotes();
  notesMeetingId = meetingId;
  const box = $("notes");
  box.value = "";
  $("notes-status").textContent = "";
  if (!meetingId) {
    $("notes-target").textContent = "Notes attach to the next meeting you record.";
    return;
  }
  const m = meetings.find((x) => x.id === meetingId);
  $("notes-target").textContent = `For: ${state.recording?.meetingId === meetingId ? state.recording.title : m?.title || "last session"}`;
  try {
    const res = await fetch(`${BACKEND}/api/meetings/${meetingId}/notes`);
    if (res.ok && notesMeetingId === meetingId && !notesDirty) box.value = (await res.json()).raw_notes || "";
  } catch (e) {}
}

async function saveNotes() {
  if (!notesMeetingId) return;
  clearTimeout(notesTimer);
  notesDirty = false;
  try {
    await fetch(`${BACKEND}/api/meetings/${notesMeetingId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw_notes: $("notes").value, source: "extension" }),
    });
    $("notes-status").textContent = "Saved";
  } catch (e) {
    $("notes-status").textContent = "Not saved — backend offline";
  }
}

// ----------------- Events -----------------
function bindEvents() {
  $("start-btn").addEventListener("click", () => startRecording());

  $("stop-btn").addEventListener("click", async () => {
    $("stop-btn").disabled = true;
    if (notesDirty) await saveNotes();
    await chrome.runtime.sendMessage({ type: "STOP_RECORDING", reason: "panel" }).catch(() => {});
    $("stop-btn").disabled = false;
    loadSessions();
  });

  $("rec-title").addEventListener("change", async (e) => {
    const title = e.target.value.trim();
    if (!title || !state.recording) return;
    await chrome.runtime.sendMessage({ type: "RENAME_SESSION", title });
    fetch(`${BACKEND}/api/meetings/${state.recording.meetingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }).then(scheduleSessionsReload).catch(() => {});
  });


  // Session settings view
  $("settings-btn").addEventListener("click", () => showView($("settings-view").hidden ? "settings" : "main"));
  $("settings-back").addEventListener("click", () => showView("main"));
  for (const id of ["sf-title", "sf-agenda", "sf-attendees"]) {
    $(id).addEventListener("input", () => {
      sessionFormDirty = true;
      $("session-form-status").textContent = "Unsaved";
    });
  }
  $("sf-save").addEventListener("click", saveSessionForm);
  document.querySelectorAll("[data-setting]").forEach((el) => {
    el.addEventListener("change", () => updateSetting(el.dataset.setting, el.checked));
  });
  document.querySelectorAll("[data-config]").forEach((el) => {
    el.addEventListener("change", () => saveConfig(el.dataset.config, el.value.trim()));
  });

  $("alert-close").addEventListener("click", () => chrome.runtime.sendMessage({ type: "CLEAR_ERROR" }));

  $("notes").addEventListener("input", () => {
    notesDirty = true;
    $("notes-status").textContent = "Typing…";
    clearTimeout(notesTimer);
    notesTimer = setTimeout(saveNotes, 1000);
  });

  $("chat-send").addEventListener("click", sendChat);
  $("chat-input").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
}

async function startRecording() {
  const buttons = [$("start-btn")];
  buttons.forEach((b) => (b.disabled = true));
  await refreshActiveTab();
  const res = await chrome.runtime.sendMessage({ type: "START_RECORDING", tabId: activeTabId, source: "panel" })
    .catch((e) => ({ ok: false, error: e.message }));
  buttons.forEach((b) => (b.disabled = false));
  if (res?.ok) loadSessions();
}

async function sendChat() {
  const input = $("chat-input");
  const query = input.value.trim();
  const meetingId = $("chat-session").value;
  if (!query) return;
  if (!meetingId) {
    addMsg("Process a meeting first — questions are answered from its transcript.", "bot");
    return;
  }
  input.value = "";
  addMsg(query, "user");
  const pending = addMsg("Reading the transcript…", "bot pending");
  try {
    const res = await fetch(`${BACKEND}/api/meetings/${meetingId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, thinking: false }),
    });
    const data = await res.json();
    pending.classList.remove("pending");
    pending.innerHTML = escapeHtml(data.response || "No answer.").replace(/\[(\d{2}:\d{2}:\d{2})\]/g, '<span class="ts">$1</span>');
  } catch (e) {
    pending.classList.remove("pending");
    pending.textContent = "Backend offline.";
  }
}

function addMsg(text, cls) {
  const el = document.createElement("div");
  el.className = `msg ${cls}`;
  el.textContent = text;
  $("chat").appendChild(el);
  $("chat").scrollTop = $("chat").scrollHeight;
  return el;
}

// ----------------- Session settings -----------------
async function showView(view) {
  const settingsOpen = view === "settings";
  $("settings-view").hidden = !settingsOpen;
  $("main-view").hidden = settingsOpen;
  $("settings-btn").classList.toggle("active", settingsOpen);
  await chrome.storage.session.remove("openView").catch(() => {});
  if (settingsOpen) {
    sessionFormDirty = false;
    fillSessionForm();
    loadConfig();
  }
}

// The form edits the live session while recording, otherwise it queues details for the next one
async function fillSessionForm(meeting) {
  const rec = state.recording;
  const pending = state.pendingSession;
  $("session-form-title").textContent = rec ? "Current session" : "Next session";
  $("session-form-hint").textContent = rec
    ? `Editing “${rec.title}” — changes show up on the dashboard right away.`
    : "Applies to the next meeting you record. Leave blank to use the meeting's own title.";
  $("session-form-status").textContent = "";
  if (rec) {
    if (!meeting) {
      try {
        meeting = await (await fetch(`${BACKEND}/api/meetings/${rec.meetingId}`)).json();
      } catch (e) {
        meeting = { title: rec.title };
      }
    }
    if (sessionFormDirty) return;
    $("sf-title").value = meeting.title || rec.title || "";
    $("sf-agenda").value = meeting.agenda || "";
    $("sf-attendees").value = (meeting.attendees || []).join(", ");
  } else {
    $("sf-title").value = pending?.title || "";
    $("sf-agenda").value = pending?.agenda || "";
    $("sf-attendees").value = (pending?.attendees || []).join(", ");
  }
}

async function saveSessionForm() {
  const btn = $("sf-save");
  btn.disabled = true;
  const res = await chrome.runtime.sendMessage({
    type: "SET_SESSION_DETAILS",
    details: {
      title: $("sf-title").value,
      agenda: $("sf-agenda").value,
      attendees: $("sf-attendees").value.split(","),
    },
  }).catch((e) => ({ ok: false, error: e.message }));
  btn.disabled = false;
  if (res?.ok) {
    sessionFormDirty = false;
    $("session-form-status").textContent = res.applied === "current" ? "Saved to this session" : "Saved for next session";
    scheduleSessionsReload();
  } else {
    $("session-form-status").textContent = res?.error || "Not saved";
  }
}

function applySettings(next) {
  if (!next) return;
  settings = next;
  document.querySelectorAll("[data-setting]").forEach((el) => {
    el.checked = Boolean(settings[el.dataset.setting]);
  });
}

async function updateSetting(key, value) {
  const res = await chrome.runtime.sendMessage({ type: "UPDATE_SETTINGS", settings: { [key]: value } }).catch(() => null);
  applySettings(res?.settings);
}

function applyConfig(next) {
  if (!next) return;
  config = { ...config, ...next };
  document.querySelectorAll("[data-config]").forEach((el) => {
    const v = config[el.dataset.config];
    if (v === undefined || document.activeElement === el) return;
    if (el.tagName === "SELECT" && v && ![...el.options].some((o) => o.value === v)) {
      el.add(new Option(v, v));
    }
    el.value = v;
  });
}

async function loadConfig() {
  try {
    const [cfg, whisper, llm] = await Promise.all([
      fetch(`${BACKEND}/api/settings`).then((r) => r.json()),
      fetch(`${BACKEND}/api/models/whisper`).then((r) => r.json()).catch(() => ({ models: [] })),
      fetch(`${BACKEND}/api/settings/models`).then((r) => r.json()).catch(() => ({ models: [] })),
    ]);
    const ready = (whisper.models || []).filter((m) => m.ready || m.downloaded);
    $("cfg-whisper").innerHTML = ready.length
      ? ready.map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join("")
      : '<option value="">No Whisper model downloaded</option>';
    const llms = (llm.models || []).filter((m) => !/embed/i.test(m));
    $("cfg-llm").innerHTML = llms.length
      ? llms.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("")
      : `<option value="${escapeHtml(cfg.lm_studio_model || "")}">${escapeHtml(cfg.lm_studio_model || "LM Studio offline")}</option>`;
    $("ai-status").textContent = llm.online ? "LM Studio connected" : "LM Studio offline";
    config = {};
    applyConfig(cfg);
    applySettings(await chrome.runtime.sendMessage({ type: "SETTINGS_CHANGED", settings: cfg }).then((r) => r?.settings).catch(() => null));
  } catch (e) {
    $("ai-status").textContent = "Backend offline";
  }
}

async function saveConfig(key, value) {
  if (!value) return;
  try {
    const res = await fetch(`${BACKEND}/api/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
    applyConfig(await res.json());
    $("ai-status").textContent = "Saved";
  } catch (e) {
    $("ai-status").textContent = "Backend offline — not saved";
  }
}

// ----------------- Utils -----------------
function fmtDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${m}:${sec}` : `${m}:${sec}`;
}

function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
