// AURA-MEET Side Panel: current meeting, notes, separate sessions and Q&A.
// Recording itself lives in the background worker + offscreen document, so closing this panel never stops it.

const BACKEND = "http://localhost:8000";
const WS_LIVE = "ws://localhost:8000/ws/live";
const DASHBOARD = "http://localhost:3000";

const $ = (id) => document.getElementById(id);
const nowCard = $("now-card");

let state = { recording: null, detected: {}, lastSession: null, lastError: null };
let activeTabId = null;
let meetings = [];
const progress = {}; // meetingId -> {progress, message, status}
let timerInterval = null;
let notesMeetingId = null;
let notesTimer = null;
let notesDirty = false;

// ----------------- Boot -----------------
document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  await refreshActiveTab();
  const res = await chrome.runtime.sendMessage({ type: "GET_STATE" }).catch(() => null);
  if (res) {
    state = res.state;
    $("auto-record").checked = Boolean(res.settings?.autoRecord);
  }
  render();
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
  const detected = activeTabId != null ? state.detected[activeTabId] : null;
  const view = rec ? "recording" : detected ? "detected" : "idle";
  nowCard.dataset.state = view;

  clearInterval(timerInterval);
  if (rec) {
    const tick = () => { $("rec-timer").textContent = fmtDuration((Date.now() - rec.startedAt) / 1000); };
    tick();
    timerInterval = setInterval(tick, 1000);
    if (document.activeElement !== $("rec-title")) $("rec-title").value = rec.title;
    document.querySelector(".meter:nth-child(1)").classList.toggle("off", !rec.micOk);
    document.querySelector(".meter:nth-child(2)").classList.toggle("off", !rec.tabOk);
  } else if (detected) {
    $("detected-platform").textContent = platformName(detected.platform);
    $("detected-title").textContent = detected.title || "Meeting";
  }

  // Alert
  if (state.lastError) {
    $("alert-text").textContent = state.lastError;
    $("alert").hidden = false;
  } else {
    $("alert").hidden = true;
  }

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
    } else if (msg.type === "RECORDING_STARTED" || msg.type === "RECORDING_STOPPED") {
      scheduleSessionsReload();
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
      body: JSON.stringify({ raw_notes: $("notes").value }),
    });
    $("notes-status").textContent = "Saved";
  } catch (e) {
    $("notes-status").textContent = "Not saved — backend offline";
  }
}

// ----------------- Events -----------------
function bindEvents() {
  $("start-btn").addEventListener("click", () => startRecording());
  $("record-tab-btn").addEventListener("click", () => startRecording());

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

  $("auto-record").addEventListener("change", (e) => {
    chrome.runtime.sendMessage({ type: "UPDATE_SETTINGS", settings: { autoRecord: e.target.checked } });
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
  const buttons = [$("start-btn"), $("record-tab-btn")];
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

function platformName(p) {
  return { meet: "Google Meet", zoom: "Zoom", teams: "Teams" }[p] || "Meeting";
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
