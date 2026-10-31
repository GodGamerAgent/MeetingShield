# Quorum

**Private meeting notes that never leave your machine.**

Record a meeting tab with one click. Quorum transcribes it with Whisper and uses **Gemma 4** to write down what was decided and who owns each next step. Audio, transcripts and notes stay on your computer, with no cloud note-taker involved.

> Built during **Hacktoberfest Hack Day — Hyderabad × SMRU (30–31 Oct 2026)**.
> **Problem statement:** #1 Smart Meeting Assistant
> **Track:** Track 2: Best Use of Gemma 4

---

## Models and licences

| | |
|---|---|
| **Application code** | MIT License (see [`LICENSE`](LICENSE)) |
| **AI model (summaries, decisions, owners, Q&A)** | Gemma 4 26B A4B, instruction-tuned, QAT build. Exact ID served by LM Studio: `google/gemma-4-26b-a4b-qat` |
| Model source | [huggingface.co/google/gemma-4-26B-A4B-it](https://huggingface.co/google/gemma-4-26B-A4B-it) · [Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4) |
| Model terms | [Apache License 2.0](https://ai.google.dev/gemma/apache_2) |
| **Speech-to-text model** | OpenAI Whisper `large-v3-turbo`, run with faster-whisper (CTranslate2 build [`mobiuslabsgmbh/faster-whisper-large-v3-turbo`](https://huggingface.co/mobiuslabsgmbh/faster-whisper-large-v3-turbo)) |
| Model source | [huggingface.co/openai/whisper-large-v3-turbo](https://huggingface.co/openai/whisper-large-v3-turbo) |
| Model terms | MIT License |
| Voice activity detection | Silero VAD (bundled with [faster-whisper](https://github.com/SYSTRAN/faster-whisper)), MIT License |
| Runtime | [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (MIT) · [LM Studio](https://lmstudio.ai) local server (OpenAI-compatible API) |

Your code's licence does not replace the models' licences. Each model keeps its own terms, listed above.

### Where Gemma 4 does the work (Track 2)

All Gemma calls go through LM Studio's local API in [`backend/intelligence_engine.py`](backend/intelligence_engine.py):

| Feature | Function | What Gemma does |
|---|---|---|
| Meeting summary | `generate_post_meeting_synthesis` | Reads the transcript and returns JSON: summary, **decisions**, **action items with owners and deadlines**, rejected alternatives, things to remember |
| Long meetings | `_build_digest` | Summarizes long transcripts section by section first (map-reduce), so nothing is cut off |
| Ask about a meeting | `answer_chat_query` | Answers questions from the transcript only and cites `[HH:MM:SS]` timestamps |
| Enhance my notes | `enhance_user_notes` | Merges your rough notes with facts and timestamps from the transcript |
| Coaching | inside the summary prompt | Reviews only *your* lines (mic channel) for clarity and tone |

If LM Studio is offline, Quorum says so and lists sentences from the transcript that look like commitments, word for word. It never makes up a summary.

---

## What it does

1. **You start a recording.** In the Chrome extension, click **Start recording this tab**, press `⌥⇧R` / `Alt+Shift+R`, or right-click the icon. Nothing is recorded until you do.
2. **One stereo file per meeting.** Your microphone goes on the left channel and the meeting tab's audio on the right, in `recordings/<session-id>/audio.wav`.
3. **You stop it**, from the side panel, the dashboard or the shortcut. Whisper transcribes on-device, and each line is labelled **you** or **others** by comparing the two channels.
4. **Gemma 4 writes the notes:** summary, decisions, owners and deadlines, plus `meeting_notes.md` in the session folder.
5. **Dashboard** at <http://localhost:3001>: sessions, transcript with audio playback, action items (exportable to Google, Outlook or Apple calendars), Q&A, notes, a people view and a personal communication coach.

Session settings (title, agenda, attendees, your name, Whisper model, language, Gemma model) are in the extension under the gear button or **right-click icon → Session settings…**. They stay in sync with the dashboard.

```
Chrome extension ──(stereo PCM over WebSocket)──▶ FastAPI backend ──▶ recordings/<id>/audio.wav
   side panel                                         │
   ⌥⇧R / right-click menu                             ├─ faster-whisper (Whisper large-v3-turbo, Silero VAD)
                                                      ├─ LM Studio → Gemma 4 (summary, owners, Q&A)
Next.js dashboard ◀──(REST proxy + live events)───────┴─ SQLite (sessions, transcript, to-dos)
```

---

## How to run

### Requirements
- macOS, Linux or Windows (tested on macOS with Apple Silicon)
- Python 3.11+ and Node.js 18+
- Google Chrome (or Brave / Edge)
- [LM Studio](https://lmstudio.ai) with Gemma 4 downloaded (search `gemma-4-26b-a4b`). Machines with less memory can use a smaller Gemma 4; set its ID in Settings.

### 1. Start Gemma 4 in LM Studio
1. Load the Gemma 4 model.
2. Open the **Developer** tab and start the server on port `1234` (`http://localhost:1234/v1`).

### 2. Start Quorum
```bash
git clone https://github.com/GodGamerAgent/MeetingShield.git quorum
cd quorum
cp .env.example .env        # optional: change the model ID or URLs
./start.sh
```
On the first run, `start.sh` creates the Python virtualenv and installs the dashboard. Whisper `large-v3-turbo` (~1.6 GB) downloads automatically the first time a meeting is transcribed, or ahead of time from **Settings → Whisper models**.

- Dashboard: <http://localhost:3001>
- Backend API: <http://localhost:8000> (docs at `/docs`)

### 3. Install the Chrome extension
1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `extension/` folder. You can also download the latest build from the dashboard and unzip it.
3. Pin **Quorum** to the toolbar. Allow microphone access when asked; it's needed once.

### 4. Record a meeting
Open your meeting tab, click the Quorum icon, then **Start recording this tab**. Stop when the meeting ends; the notes appear on the dashboard a minute or two later.

### Tests
```bash
backend/venv/bin/python backend/test_suite.py
```
Runs against a throwaway database and folder, including real Whisper transcription of synthesized speech. Your sessions are never touched.

---

## Project structure

```
backend/     FastAPI API, recorder, Whisper pipeline, Gemma prompts, SQLite
extension/   Chrome extension (Manifest V3): side panel, offscreen stereo recorder
web/         Next.js dashboard (port 3001); /api is proxied to the backend
recordings/  One folder per session: audio.wav + meeting_notes.md (git-ignored)
```

## Privacy
- Audio, transcripts and notes are stored only on your machine (`recordings/`, `backend/quorum.db`).
- Recordings and transcripts are never uploaded. Everything runs over `localhost` (backend, LM Studio, dashboard). The internet is only used to download models once, and when *you* open a calendar export link.
- Recording only starts when you click Start, and the badge shows **REC** while it runs. Tell the other participants you are recording.

## Code of conduct
This project was built at an MLH event and follows the [MLH Code of Conduct](https://mlh.io/code-of-conduct).

## License
Quorum's code is released under the [MIT License](LICENSE). The models it uses keep their own licences (see above).
