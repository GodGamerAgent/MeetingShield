// AURA-MEET content script: detects when you are actually in a call (not the lobby),
// tells the background worker, and shows a small recording indicator on the page.

(() => {
  if (window.top !== window || window.__auraMeetLoaded) return;
  window.__auraMeetLoaded = true;

  const POLL_MS = 1500;
  const JOIN_CONFIRMATIONS = 2; // ~3s in call before we call it a meeting
  const LEAVE_CONFIRMATIONS = 4; // ~6s out of call before we end it (UI re-renders can flicker)

  const PLATFORMS = {
    meet: {
      match: () => location.hostname === "meet.google.com" && /^\/[a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4}/i.test(location.pathname),
      inCall: () => Boolean(
        document.querySelector('[jsname="CQylAd"], button[aria-label*="Leave call" i], button[aria-label*="leave call" i]')
      ),
      title: () => {
        const el = document.querySelector("[data-meeting-title]");
        const t = el?.getAttribute("data-meeting-title") || el?.textContent;
        if (t && t.trim()) return t.trim();
        const code = location.pathname.split("/")[1];
        const docTitle = document.title.replace(/^Meet\s*[-–:]\s*/i, "").trim();
        return docTitle && docTitle !== "Meet" && docTitle !== code ? docTitle : `Google Meet · ${code}`;
      },
    },
    zoom: {
      match: () => /zoom\.us$/.test(location.hostname) && /\/(wc|j)\//.test(location.pathname),
      inCall: () => Boolean(
        document.querySelector('.footer__leave-btn, button[aria-label="Leave"], button[aria-label*="Leave meeting" i], button[aria-label*="End meeting" i]')
      ),
      title: () => {
        const t = document.querySelector(".meeting-info-container__header, .meeting-title")?.textContent?.trim();
        return t || "Zoom meeting";
      },
    },
    teams: {
      match: () => /teams\.(microsoft|live)\.com$/.test(location.hostname),
      inCall: () => Boolean(
        document.querySelector('#hangup-button, [data-tid="hangup-main-btn"], [data-tid="call-hangup"], button[aria-label^="Leave" i][id*="hangup" i]')
      ),
      title: () => {
        const t = document.querySelector('[data-tid="call-title"], [data-tid="meeting-title"]')?.textContent?.trim();
        return t || document.title.replace(/\s*\|\s*Microsoft Teams.*$/i, "").trim() || "Teams meeting";
      },
    },
  };

  let platformKey = null;
  let reportedInCall = false;
  let streak = 0;
  let sessionState = null;
  let myTabId = null;
  let promptDismissed = false;

  function currentPlatform() {
    for (const [key, p] of Object.entries(PLATFORMS)) {
      if (p.match()) return key;
    }
    return null;
  }

  function poll() {
    platformKey = currentPlatform();
    const inCall = platformKey ? PLATFORMS[platformKey].inCall() : false;

    if (inCall !== reportedInCall) {
      streak++;
      if (streak >= (inCall ? JOIN_CONFIRMATIONS : LEAVE_CONFIRMATIONS)) {
        reportedInCall = inCall;
        streak = 0;
        if (inCall) promptDismissed = false;
        report();
      }
    } else {
      streak = 0;
      // Keep the title fresh (Meet fills it in after join)
      if (inCall && Date.now() - lastReport > 15000) report();
    }
  }

  let lastReport = 0;
  function report() {
    lastReport = Date.now();
    const p = platformKey && PLATFORMS[platformKey];
    chrome.runtime.sendMessage({
      type: "MEETING_STATE",
      inCall: reportedInCall,
      platform: platformKey,
      title: p ? safe(p.title) : "",
      url: location.href,
    }).catch(() => {});
  }

  function safe(fn) {
    try {
      return fn();
    } catch (e) {
      return "";
    }
  }

  // ----------------- On-page indicator -----------------
  const root = document.createElement("div");
  root.id = "aura-meet-indicator";
  root.innerHTML = `
    <div class="aura-chip">
      <span class="aura-dot"></span>
      <span class="aura-label"></span>
      <button class="aura-action" type="button"></button>
      <button class="aura-close" type="button" title="Hide">&times;</button>
    </div>
    <div class="aura-hint"></div>
  `;
  const label = root.querySelector(".aura-label");
  const action = root.querySelector(".aura-action");
  const hint = root.querySelector(".aura-hint");
  root.querySelector(".aura-close").addEventListener("click", () => {
    promptDismissed = true;
    render();
  });
  action.addEventListener("click", onAction);

  function mount() {
    if (!document.body) return;
    if (!root.isConnected) document.body.appendChild(root);
  }

  async function onAction() {
    const mode = action.dataset.mode;
    if (mode === "start") {
      action.disabled = true;
      const res = await chrome.runtime.sendMessage({ type: "START_RECORDING", source: "page" }).catch((e) => ({ ok: false, error: e.message }));
      action.disabled = false;
      if (!res?.ok) {
        hint.textContent = res?.needsInvocation
          ? "Chrome needs one click on the AURA toolbar icon (or ⌥⇧R) before it lets an extension record a tab."
          : res?.error || "Could not start recording.";
        hint.classList.add("show");
      }
    } else if (mode === "stop") {
      action.disabled = true;
      await chrome.runtime.sendMessage({ type: "STOP_RECORDING", reason: "page" }).catch(() => {});
      action.disabled = false;
    } else if (mode === "open") {
      chrome.runtime.sendMessage({ type: "OPEN_URL", url: `http://localhost:3000/meetings/${action.dataset.meetingId}` });
    }
  }

  let timerInterval = null;
  function render() {
    clearInterval(timerInterval);
    const s = sessionState;
    const recordingHere = s?.recording && s.recording.tabId === myTabId;
    const recordingElsewhere = s?.recording && s.recording.tabId !== myTabId;
    const last = s?.lastSession;
    const showLast = !recordingHere && last && Date.now() - last.endedAt < 60000 && !reportedInCall;

    root.className = "";
    if (recordingHere) {
      root.className = "recording";
      const tick = () => { label.textContent = `Recording · ${fmt(Date.now() - s.recording.startedAt)}`; };
      tick();
      timerInterval = setInterval(tick, 1000);
      action.textContent = "Stop";
      action.dataset.mode = "stop";
      hint.classList.remove("show");
    } else if (reportedInCall && !recordingElsewhere && !promptDismissed) {
      root.className = "detected";
      label.textContent = "Meeting detected";
      action.textContent = "Record";
      action.dataset.mode = "start";
    } else if (showLast) {
      root.className = "done";
      label.textContent = "Saved · transcribing & summarizing";
      action.textContent = "Open";
      action.dataset.mode = "open";
      action.dataset.meetingId = last.meetingId;
    } else {
      root.className = "hidden";
      hint.classList.remove("show");
    }
    mount();
  }

  function fmt(ms) {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    const sec = String(total % 60).padStart(2, "0");
    return h ? `${h}:${m}:${sec}` : `${m}:${sec}`;
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "SESSION_STATE") {
      sessionState = message.state;
      if (message.tabId) myTabId = message.tabId;
      render();
    }
  });

  chrome.runtime.sendMessage({ type: "GET_STATE" }).then((res) => {
    sessionState = res?.state || null;
    myTabId = res?.tabId ?? myTabId;
    render();
  }).catch(() => {});

  setInterval(poll, POLL_MS);
  poll();
})();
