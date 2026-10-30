# 🎙️ AURA-MEET: On-Device Smart Meeting Intelligence & Behavioral Copilot

> **Production-grade on-device meeting intelligence, agenda drift guard, and executive behavioral coach powered by Gemma 4.**

---

## 🏗️ System Architecture Overview

A cohesive Monorepo built for privacy-first, on-device Apple Silicon execution:

```
MeetingShield/
├── backend/                  # FastAPI Audio & Intelligence Engine (Python 3.11+)
│   ├── main.py               # REST API & WebSockets (/ws/audio, /ws/live)
│   ├── audio_pipeline.py     # Butterworth 80-8kHz filter, Silero VAD, faster-whisper
│   ├── context_manager.py    # Hierarchical 3-tier sliding window + SQLite FTS5 search
│   ├── intelligence_engine.py# LM Studio Gemma 4 client, drift evaluator & coaching
│   ├── individual_tracker.py # Longitudinal 1-on-1 person relationship dossiers
│   ├── calendar_service.py   # Universal 3-Calendar export (Google, Outlook, Apple .ics)
│   ├── config_store.py       # Dynamic settings with JSON/SQLite persistence
│   └── database.py           # SQLite database schema, FTS5 virtual tables, and seed data
│
├── extension/                # Chrome Browser Extension (Manifest V3)
│   ├── manifest.json         # Manifest V3 (tabCapture, offscreen, sidePanel)
│   ├── background.js         # Session lifecycle: detected → recording → finished → processing
│   ├── offscreen.html / js   # Single-stream capture (mic = L, meeting tab = R) with playback
│   ├── recorder-worklet.js   # AudioWorklet producing interleaved 16 kHz int16 PCM
│   ├── sidepanel.html / js   # Current meeting, notes, sessions list, Q&A
│   └── content.js / css      # In-call detection for Meet / Zoom / Teams + on-page REC chip
│
├── web/                      # 3D Responsive Web Application (Next.js 14 App Router)
│   ├── src/app/page.tsx      # View 1: Home — meeting in progress + recent sessions
│   ├── src/app/meetings/     # View 2: Sessions list & per-meeting transcript, summary, to-dos
│   ├── src/app/coach/        # View 3: Personal Behavioral & Response Coach (ME audit)
│   ├── src/app/people/       # View 4: 1-on-1 Individual Relationship Dossiers
│   ├── src/app/settings/     # View 5: LM Studio Gemma 4 Routing & Audio Controls
│   └── src/components/       # 3D Three.js canvas, CalendarModal, DriftGauge, Recharts
│
└── start.sh                  # 1-click startup script for macOS
```

---

## ⚡ Quick Setup Checklist for MacBook Pro M5 Pro

### Step 1: Configure LM Studio (Gemma 4 Local Server)
1. **Launch LM Studio** on your Mac.
2. Navigate to the **Developer / Local Server** tab (`<->` icon on the left sidebar).
3. **Load Model:** Select your **Gemma 4** model from the top dropdown to load it into Unified RAM.
4. **Server Settings:**
   - Locate the **Server Settings** panel on the right.
   - Toggle **Enable CORS** to **ON**.
   - Set **Port** to `1234`.
5. **Start Server:** Click **Start Server**.
   - Endpoint: `http://localhost:1234/v1`

*(Note: If LM Studio is not yet running, AURA-MEET gracefully operates in Local Intelligence Mode, ensuring every chart, 3D visual, and coaching card works immediately.)*

---

### Step 2: Install Chrome Extension (Manifest V3)
1. Open **Google Chrome** and navigate to:
   ```text
   chrome://extensions/
   ```
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** in the top-left corner.
4. Select the `/extension` directory inside this workspace (`MeetingShield/extension`).
5. Pin the **AURA-MEET** icon in your Chrome toolbar.

---

### Step 3: Launch AURA-MEET
Run the root startup script:
```bash
./start.sh
```

- **Web Dashboard:** [http://localhost:3000](http://localhost:3000)
- **FastAPI Engine:** [http://localhost:8000](http://localhost:8000)
- **Interactive API Docs:** [http://localhost:8000/docs](http://localhost:8000/docs)

---

## 🌟 Core Features & Views

### How a meeting flows
1. **Join a call** in Chrome (Google Meet, Zoom web client, or Teams). The extension waits until you are actually *in* the call (not the lobby) and shows a "Meeting detected" chip.
2. **Record with one click** — the AURA toolbar icon or `⌥⇧R`. Chrome requires this one gesture per tab before an extension may capture tab audio. With *Record automatically* on (default), a click on the icon starts recording straight away. If you clicked the icon on that tab before joining, recording starts by itself when you join.
3. **Each meeting is its own session**: a new backend session, folder (`recordings/<id>/audio.wav`) and notes. Rejoining creates a new session.
4. **Leave the call** — recording stops automatically (also when the tab closes or navigates away). Whisper then transcribes the whole recording, each line is attributed to *you* (mic channel) or *others* (meeting audio channel), and Gemma writes the summary, decisions, to-dos and coaching from the real transcript.
5. Rename "Others" to a person's name on the transcript (optionally for every line) to build their People dossier.

### 1. Home (`/`)
- Live status of the meeting being recorded (timer, mic and meeting audio levels, Stop & process).
- Processing progress and the list of recent sessions.

### 2. Post-Meeting Intelligence Hub (`/meetings/[id]`)
- **Executive Summary & 10-Minute Epoch Digests:** Scrub through sliding-window compacted blocks for multi-hour sessions.
- **Approved Decisions & Rejected Alternatives:** High-visibility strategic breakdowns.
- **Prioritized To-Do Board:** Check off deliverables, filter by owner, and click **"Add to Calendar"**.
- **Universal Calendar Exporter Modal:** 1-click integration for:
  - **Google Calendar** (prefilled event deeplink)
  - **Microsoft Outlook Web** (Office 365 compose deeplink)
  - **Apple Calendar / RFC-5545 `.ics`** (direct download for macOS & iOS)
- **"Things to Remember" Vault:** Sticky memory cards highlighting financial figures, dates, and subtle participant preferences.

### 3. Personal Behavioral & Response Coach (`/coach`)
- **Auditing `ME (User)`:** Specifically audits the user's transcript stream against meeting outcomes.
- **Executive Communication Scorecard:** Clarity Score, Listening/Empathy Ratio, Filler Word Count, Interruption Rate.
- **Side-by-Side Response Upgrades:**
  - *Left (Soft Rose tint):* "What You Actually Said [HH:MM:SS]" + "Suboptimal Tone / Over-promising".
  - *Right (Warm Peach / Gold highlight):* "How You Should Have Responded" (tactical upgraded phrasing) + "Psychological & Strategic Principle".

### 4. 1-on-1 Individual Relationship Dossier (`/people`)
- Searchable directory of colleagues met with.
- **Longitudinal History:** Every conversation snippet across all meetings with exact timestamps.
- **Commitments Ledger:** "Promises they made to you" vs. "Promises you made to them".
- **AI-Generated Communication Playbook:** How to communicate effectively with each person based on their speaking patterns.
- Private strategic notes with persistence.

### 5. Settings & LM Studio Control Center (`/settings`)
- **Gemma 4 Routing:** Dynamic model discovery via `GET /v1/models`, endpoint configuration, and latency test.
- **Audio Pipeline Controls:** Toggle Butterworth bandpass filter (80Hz–8kHz) and adjust Silero VAD silence stripping aggressiveness.
- **Hardware Mic Tester:** Live real-time audio level visualizer.
- **Calendar & Identity Preferences:** Set default calendar and customize spoken `ME` name.

---

## 🎧 Audio Capture Details
The extension records **one sample-aligned stereo stream** per meeting, with no live transcription during the call:
1. **Meeting audio (`chrome.tabCapture` → right channel):** routed back to your speakers so you still hear the call.
2. **Your microphone (`getUserMedia` with echo cancellation → left channel).**
3. An AudioWorklet streams 0.25 s blocks of 16 kHz int16 PCM over `ws://localhost:8000/ws/audio`; blocks are buffered and resent if the backend restarts mid-meeting.
4. After the meeting, both channels are level-matched and mixed for Whisper (`large-v3-turbo`, VAD, hallucination filtering). Each word is attributed by comparing channel energy, then grouped into speaker turns.
