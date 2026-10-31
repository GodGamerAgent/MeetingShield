import asyncio
import base64
import json
import uuid
import os
import shutil
import time
import re
import subprocess
import sys
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query, Response
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from config_store import config_store
from database import init_db, get_db, clear_all_data, seed_initial_data
from audio_pipeline import audio_pipeline
from context_manager import context_manager
from intelligence_engine import intelligence_engine, TODO_ORDER
from individual_tracker import individual_tracker
from calendar_service import calendar_service
from markdown_exporter import generate_meeting_markdown, save_meeting_markdown_file, get_meeting_markdown_path

app = FastAPI(
    title="Quorum API",
    description="Private, on-device meeting notes: recording, Whisper transcription and Gemma 4 summaries",
    version="1.0.0"
)

# Enable CORS for Next.js frontend, Chrome Extension, and localhost
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database and pre-warm Whisper model on startup
@app.on_event("startup")
async def on_startup():
    init_db()
    # Sessions interrupted by a restart: nothing is processing or recording any more
    conn = get_db()
    conn.execute("UPDATE meetings SET status = 'recorded' WHERE status IN ('processing', 'recording', 'active')")
    conn.commit()
    conn.close()
    print("[Quorum] Backend started, SQLite schema ready.")
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, _prewarm_whisper)

def _prewarm_whisper():
    try:
        audio_pipeline._get_whisper_model()
    except Exception as e:
        print(f"[Quorum] Whisper pre-warm notice: {e}")

# Connection Manager for /ws/live
class LiveConnectionHub:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: Dict[str, Any]):
        for conn in list(self.active_connections):
            try:
                await conn.send_json(message)
            except Exception:
                self.disconnect(conn)

live_hub = LiveConnectionHub()

# ----------------- Models -----------------
class MeetingCreateReq(BaseModel):
    title: str = Field(..., example="Sprint 14 Planning")
    agenda: Optional[str] = Field(default="", example="Review backlog, prioritize roadmap")
    attendees: Optional[List[str]] = Field(default_factory=list)
    platform: Optional[str] = ""
    meeting_url: Optional[str] = ""
    status: Optional[str] = "recording"

class FinishMeetingReq(BaseModel):
    auto_process: Optional[bool] = None  # None = use the shared "auto process" setting
    raw_notes: Optional[str] = None

class MeetingUpdateReq(BaseModel):
    title: Optional[str] = None
    agenda: Optional[str] = None
    attendees: Optional[List[str]] = None
    status: Optional[str] = None

class TranscriptSegmentReq(BaseModel):
    meeting_id: str
    speaker_label: str = "ME"
    speaker_name: str = "Robin"
    is_user: int = 1
    text: str
    start_time: float
    end_time: float
    timestamp_badge: str

class ChatQueryReq(BaseModel):
    query: str
    thinking: Optional[bool] = False

class CalendarExportReq(BaseModel):
    title: str
    description: Optional[str] = ""
    deadline: Optional[str] = None
    attendees: Optional[List[str]] = None

class SettingsUpdateReq(BaseModel):
    lm_studio_base_url: Optional[str] = None
    lm_studio_model: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    vad_aggressiveness: Optional[int] = None
    noise_cleaning_enabled: Optional[bool] = None
    epoch_window_minutes: Optional[int] = None
    default_calendar: Optional[str] = None
    user_name: Optional[str] = None
    audio_export_dir: Optional[str] = None
    whisper_model: Optional[str] = None
    whisper_language: Optional[str] = None
    auto_process_enabled: Optional[bool] = None

class NotesUpdateReq(BaseModel):
    notes: str

class RawNotesReq(BaseModel):
    raw_notes: str
    source: Optional[str] = None  # "web" | "extension" — lets clients ignore their own echo

class MarkdownSaveReq(BaseModel):
    content: str

class RevealReq(BaseModel):
    os: Optional[str] = None


class ProcessMeetingReq(BaseModel):
    model_name: Optional[str] = "large-v3-turbo"
    raw_notes: Optional[str] = None

# ----------------- Status & Settings Endpoints -----------------
@app.get("/api/status")
async def get_system_status():
    lm_status = await intelligence_engine.check_lm_studio_status()
    cfg = config_store.get()
    return {
        "status": "online",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "lm_studio": lm_status,
        "config": cfg.model_dump()
    }

@app.get("/api/settings")
def get_settings():
    return config_store.get().model_dump()

@app.post("/api/settings")
async def update_settings(req: SettingsUpdateReq):
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    new_cfg = config_store.update(updates).model_dump()
    await live_hub.broadcast({"type": "SETTINGS_UPDATED", "settings": new_cfg})
    return new_cfg

def _storage_stats() -> Dict[str, Any]:
    root = config_store.get().audio_export_dir
    folders, total = [], 0
    if os.path.isdir(root):
        for entry in sorted(os.listdir(root)):
            full = os.path.join(root, entry)
            if os.path.isdir(full):
                folders.append(entry)
                total += len([f for f in os.listdir(full) if not f.startswith(".")])
    return {"directory": root, "total_files": total, "session_folders": folders}

@app.get("/api/storage")
def storage_stats():
    return _storage_stats()

@app.get("/api/settings/models")
async def list_available_models():
    return await intelligence_engine.check_lm_studio_status()

# ----------------- Meetings Endpoints -----------------
@app.get("/api/meetings")
def list_meetings():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM meetings ORDER BY created_at DESC")
    meetings = [dict(r) for r in cur.fetchall()]
    conn.close()

    for m in meetings:
        try:
            m["attendees"] = json.loads(m["attendees"] or "[]")
        except Exception:
            m["attendees"] = [m["attendees"]] if m["attendees"] else []
        m["has_audio"] = bool(audio_pipeline.get_session_audio_path(m["id"]))
    return meetings

@app.post("/api/meetings")
async def create_meeting(req: MeetingCreateReq):
    meeting_id = f"meet-{uuid.uuid4().hex[:8]}"
    now_iso = datetime.now(timezone.utc).isoformat()
    status = req.status if req.status in ("recording", "recorded", "scheduled") else "recording"
    conn = get_db()
    conn.execute("""
    INSERT INTO meetings (id, title, agenda, attendees, created_at, status, duration_sec, drift_score, platform, meeting_url)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0.0, ?, ?)
    """, (meeting_id, req.title.strip() or "Untitled meeting", req.agenda or "", json.dumps(req.attendees or []),
          now_iso, status, req.platform or "", req.meeting_url or ""))
    conn.commit()
    conn.close()
    meeting = get_meeting(meeting_id)
    await live_hub.broadcast({"type": "MEETING_CREATED", "meeting_id": meeting_id, "meeting": meeting})
    return meeting

@app.get("/api/meetings/{meeting_id}")
def get_meeting(meeting_id: str):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM meetings WHERE id = ?", (meeting_id,))
    row = cur.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Meeting not found")
    m = dict(row)
    try:
        m["attendees"] = json.loads(m["attendees"] or "[]")
    except Exception:
        m["attendees"] = []
    m["has_audio"] = bool(audio_pipeline.get_session_audio_path(meeting_id))
    m["raw_notes"] = m.get("raw_notes") or ""
    m["enhanced_notes"] = m.get("enhanced_notes") or ""
    m["folder_path"] = audio_pipeline.get_meeting_dir(meeting_id)
    m["has_markdown"] = bool(get_meeting_markdown_path(meeting_id))
    return m

@app.patch("/api/meetings/{meeting_id}")
async def update_meeting(meeting_id: str, req: MeetingUpdateReq):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM meetings WHERE id = ?", (meeting_id,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Meeting not found")

    updates = []
    params = []
    if req.title is not None:
        updates.append("title = ?")
        params.append(req.title)
    if req.agenda is not None:
        updates.append("agenda = ?")
        params.append(req.agenda)
    if req.attendees is not None:
        updates.append("attendees = ?")
        params.append(json.dumps(req.attendees))
    if req.status is not None:
        updates.append("status = ?")
        params.append(req.status)

    if updates:
        params.append(meeting_id)
        cur.execute(f"UPDATE meetings SET {', '.join(updates)} WHERE id = ?", tuple(params))
        conn.commit()
    conn.close()

    try:
        save_meeting_markdown_file(meeting_id)
    except Exception:
        pass

    meeting = get_meeting(meeting_id)
    await live_hub.broadcast({"type": "MEETING_UPDATED", "meeting_id": meeting_id, "meeting": meeting})
    return meeting

@app.delete("/api/meetings/{meeting_id}")
async def delete_meeting(meeting_id: str):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM meetings WHERE id = ?", (meeting_id,))
    cur.execute("DELETE FROM transcript_segments WHERE meeting_id = ?", (meeting_id,))
    cur.execute("DELETE FROM transcript_fts WHERE meeting_id = ?", (meeting_id,))
    cur.execute("DELETE FROM epoch_summaries WHERE meeting_id = ?", (meeting_id,))
    cur.execute("DELETE FROM meeting_analysis WHERE meeting_id = ?", (meeting_id,))
    cur.execute("DELETE FROM todos WHERE meeting_id = ?", (meeting_id,))
    cur.execute("DELETE FROM things_to_remember WHERE meeting_id = ?", (meeting_id,))
    cur.execute("DELETE FROM behavioral_coaching WHERE meeting_id = ?", (meeting_id,))
    cur.execute("DELETE FROM individual_interactions WHERE meeting_id = ?", (meeting_id,))
    cur.execute("""
    DELETE FROM individuals
    WHERE id NOT IN (SELECT DISTINCT individual_id FROM individual_interactions WHERE individual_id IS NOT NULL)
    """)
    conn.commit()
    conn.close()
    active_recordings.pop(meeting_id, None)

    # Remove audio and notes folder if exists
    try:
        meeting_dir = audio_pipeline.get_meeting_dir(meeting_id)
        if os.path.exists(meeting_dir) and os.path.isdir(meeting_dir):
            shutil.rmtree(meeting_dir)
    except Exception:
        pass

    # Also check standalone file if exists
    audio_path = audio_pipeline.get_session_audio_path(meeting_id)
    if audio_path and os.path.exists(audio_path):
        try:
            os.remove(audio_path)
        except Exception:
            pass

    deleted_meetings.add(meeting_id)
    ws = audio_sockets.get(meeting_id)
    if ws is not None:  # deleted while recording: tell the extension to drop it
        try:
            await ws.send_json({"status": "DELETED", "meeting_id": meeting_id})
        except Exception:
            pass
    await live_hub.broadcast({"type": "MEETING_DELETED", "meeting_id": meeting_id})
    return {"deleted": True, "id": meeting_id, "files_deleted": True}

# ----------------- Audio File Download & Info -----------------
@app.get("/api/meetings/{meeting_id}/audio")
def download_session_audio(meeting_id: str):
    audio_path = audio_pipeline.get_session_audio_path(meeting_id)
    if not audio_path or not os.path.exists(audio_path):
        raise HTTPException(status_code=404, detail="Audio recording not found for this session.")
    return FileResponse(
        path=audio_path,
        media_type="audio/wav",
        filename=f"{meeting_id}.wav"
    )

@app.get("/api/meetings/{meeting_id}/audio-info")
def get_session_audio_info(meeting_id: str):
    audio_path = audio_pipeline.get_session_audio_path(meeting_id)
    cfg = config_store.get()
    meeting_dir = audio_pipeline.get_meeting_dir(meeting_id)
    md_path = get_meeting_markdown_path(meeting_id)
    if audio_path and os.path.exists(audio_path):
        size = os.path.getsize(audio_path)
        return {
            "has_audio": True,
            "file_path": audio_path,
            "export_dir": cfg.audio_export_dir,
            "folder_path": meeting_dir,
            "markdown_path": md_path,
            "has_markdown": bool(md_path),
            "size_bytes": size,
            "size_formatted": f"{size / (1024*1024):.2f} MB"
        }
    return {
        "has_audio": False,
        "file_path": os.path.join(meeting_dir, "audio.wav"),
        "export_dir": cfg.audio_export_dir,
        "folder_path": meeting_dir,
        "markdown_path": md_path,
        "has_markdown": bool(md_path),
        "size_bytes": 0,
        "size_formatted": "0 MB"
    }

# ----------------- Notes & Markdown Export -----------------
@app.get("/api/meetings/{meeting_id}/notes")
def get_meeting_notes(meeting_id: str):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT raw_notes, enhanced_notes FROM meetings WHERE id = ?", (meeting_id,))
    row = cur.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Meeting not found")
    md_path = get_meeting_markdown_path(meeting_id)
    meeting_dir = audio_pipeline.get_meeting_dir(meeting_id)
    return {
        "meeting_id": meeting_id,
        "raw_notes": row["raw_notes"] or "",
        "enhanced_notes": row["enhanced_notes"] or "",
        "markdown_path": md_path,
        "folder_path": meeting_dir,
        "has_markdown": bool(md_path)
    }

@app.post("/api/meetings/{meeting_id}/notes")
async def save_raw_notes(meeting_id: str, req: RawNotesReq):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("UPDATE meetings SET raw_notes = ? WHERE id = ?", (req.raw_notes, meeting_id))
    conn.commit()
    conn.close()
    try:
        save_meeting_markdown_file(meeting_id)
    except Exception:
        pass
    await live_hub.broadcast({"type": "NOTES_UPDATED", "meeting_id": meeting_id, "raw_notes": req.raw_notes, "source": req.source})
    return {"status": "SUCCESS", "meeting_id": meeting_id, "raw_notes": req.raw_notes}

@app.post("/api/meetings/{meeting_id}/enhance-notes")
async def enhance_notes_endpoint(meeting_id: str, req: RawNotesReq):
    result = await intelligence_engine.enhance_user_notes(meeting_id, req.raw_notes)
    await live_hub.broadcast({"type": "NOTES_UPDATED", "meeting_id": meeting_id, "raw_notes": req.raw_notes,
                              "enhanced_notes": result.get("enhanced_notes", ""), "source": req.source})
    return result

@app.get("/api/meetings/{meeting_id}/markdown")
def get_meeting_markdown(meeting_id: str):
    content = generate_meeting_markdown(meeting_id)
    filepath = save_meeting_markdown_file(meeting_id)
    meeting_dir = audio_pipeline.get_meeting_dir(meeting_id)
    return {
        "meeting_id": meeting_id,
        "content": content,
        "file_path": filepath,
        "folder_path": meeting_dir
    }

@app.post("/api/meetings/{meeting_id}/markdown")
def save_meeting_markdown(meeting_id: str, req: MarkdownSaveReq):
    """Save hand-edited markdown to the session folder."""
    get_meeting(meeting_id)
    filepath = os.path.join(audio_pipeline.get_meeting_dir(meeting_id), "meeting_notes.md")
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(req.content)
    return {"status": "saved", "meeting_id": meeting_id, "file_path": filepath}

@app.post("/api/meetings/{meeting_id}/reveal-in-folder")
def reveal_in_folder(meeting_id: str, req: Optional[RevealReq] = None):
    get_meeting(meeting_id)
    folder = audio_pipeline.get_meeting_dir(meeting_id)
    md = get_meeting_markdown_path(meeting_id) or save_meeting_markdown_file(meeting_id)
    if sys.platform == "darwin":
        os_name, manager, cmd = "mac", "Finder", ["open", "-R", md]
    elif sys.platform.startswith("win"):
        os_name, manager, cmd = "win", "File Explorer", ["explorer", "/select,", md]
    else:
        os_name, manager, cmd = "linux", "File Manager", ["xdg-open", folder]
    try:
        subprocess.Popen(cmd)
        status, message = "opened", f"Opened the session folder in {manager}."
    except Exception as e:
        status, message = "error", f"Could not open {manager}: {e}"
    return {"status": status, "os": os_name, "file_manager_name": manager, "button_label": f"Show in {manager}",
            "command": " ".join(cmd), "file_path": md, "folder_path": folder, "message": message}

@app.post("/api/meetings/restore-demo")
async def restore_demo_sessions():
    seed_initial_data()
    await live_hub.broadcast({"type": "MEETING_CREATED", "meeting_id": "demo-meeting-01"})
    return {"status": "restored"}

@app.get("/api/meetings/{meeting_id}/download-markdown")
def download_meeting_markdown(meeting_id: str):
    filepath = save_meeting_markdown_file(meeting_id)
    return FileResponse(
        path=filepath,
        media_type="text/markdown",
        filename=f"meeting_notes_{meeting_id}.md"
    )

# ----------------- Follow-Up Drafter (Email & Slack) -----------------
@app.get("/api/meetings/{meeting_id}/followup")
async def draft_followup_endpoint(meeting_id: str, format: str = Query("email")):
    return await intelligence_engine.draft_followup(meeting_id, format_type=format)

# ----------------- Global Omnisearch -----------------
@app.get("/api/search")
def global_search(q: str = Query(..., min_length=1)):
    clean_q = q.strip()
    conn = get_db()
    cur = conn.cursor()

    # 1. Search Meetings
    cur.execute("""
    SELECT id, title, agenda, created_at, duration_sec, drift_score
    FROM meetings
    WHERE title LIKE ? OR agenda LIKE ?
    ORDER BY created_at DESC
    LIMIT 10
    """, (f"%{clean_q}%", f"%{clean_q}%"))
    matched_meetings = [dict(r) for r in cur.fetchall()]

    # 2. Search Transcripts via FTS5
    matched_transcripts = []
    try:
        terms = [f'"{t}"*' for t in clean_q.split() if len(t) > 2] or [f'"{clean_q}"']
        expr = " OR ".join(terms)
        cur.execute("""
        SELECT f.segment_id, f.meeting_id, f.speaker_name, f.text, f.timestamp_badge,
               snippet(transcript_fts, 3, '[MATCH]', '[/MATCH]', '...', 15) as snippet,
               m.title as meeting_title
        FROM transcript_fts f
        LEFT JOIN meetings m ON f.meeting_id = m.id
        WHERE transcript_fts MATCH ?
        LIMIT 15
        """, (expr,))
        matched_transcripts = [dict(r) for r in cur.fetchall()]
    except Exception:
        cur.execute("""
        SELECT s.id as segment_id, s.meeting_id, s.speaker_name, s.text, s.timestamp_badge,
               s.text as snippet, m.title as meeting_title
        FROM transcript_segments s
        LEFT JOIN meetings m ON s.meeting_id = m.id
        WHERE s.text LIKE ?
        ORDER BY s.created_at DESC
        LIMIT 15
        """, (f"%{clean_q}%",))
        matched_transcripts = [dict(r) for r in cur.fetchall()]

    # 3. Search Todos
    cur.execute("""
    SELECT t.*, m.title as meeting_title
    FROM todos t
    LEFT JOIN meetings m ON t.meeting_id = m.id
    WHERE t.task LIKE ? OR t.owner LIKE ?
    ORDER BY t.created_at DESC
    LIMIT 10
    """, (f"%{clean_q}%", f"%{clean_q}%"))
    matched_todos = [dict(r) for r in cur.fetchall()]

    # 4. Search Individuals
    cur.execute("""
    SELECT id, name, role, email, avatar_url, total_meetings, last_met, communication_cheat_sheet
    FROM individuals
    WHERE name LIKE ? OR role LIKE ? OR communication_cheat_sheet LIKE ?
    ORDER BY total_meetings DESC
    LIMIT 6
    """, (f"%{clean_q}%", f"%{clean_q}%", f"%{clean_q}%"))
    matched_people = [dict(r) for r in cur.fetchall()]

    conn.close()

    return {
        "query": clean_q,
        "meetings": matched_meetings,
        "transcripts": matched_transcripts,
        "todos": matched_todos,
        "people": matched_people,
        "total_results": len(matched_meetings) + len(matched_transcripts) + len(matched_todos) + len(matched_people)
    }

# ----------------- Transcript & Diarization -----------------
@app.get("/api/meetings/{meeting_id}/transcript")
def get_transcript(meeting_id: str):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
    SELECT * FROM transcript_segments
    WHERE meeting_id = ?
    ORDER BY start_time ASC
    """, (meeting_id,))
    segments = [dict(r) for r in cur.fetchall()]
    conn.close()
    return segments

@app.post("/api/meetings/{meeting_id}/transcript")
async def add_transcript_segment(meeting_id: str, seg: TranscriptSegmentReq):
    saved = context_manager.add_segment(
        meeting_id=meeting_id,
        speaker_label=seg.speaker_label,
        speaker_name=seg.speaker_name,
        is_user=seg.is_user,
        text=seg.text,
        start_time=seg.start_time,
        end_time=seg.end_time,
        timestamp_badge=seg.timestamp_badge
    )

    dominance = intelligence_engine.compute_dominance_ratio(meeting_id)

    # Broadcast to live subscribers
    await live_hub.broadcast({
        "type": "NEW_SEGMENT",
        "meeting_id": meeting_id,
        "segment": saved,
        "dominance": dominance
    })

    return saved

@app.put("/api/meetings/{meeting_id}/transcript/{seg_id}/speaker")
async def reassign_speaker(meeting_id: str, seg_id: str, speaker_name: str = Query(...), scope: str = Query("one")):
    """Rename the speaker of one segment, or (scope=all) every segment that had the same speaker."""
    speaker_name = speaker_name.strip()
    if not speaker_name:
        raise HTTPException(status_code=400, detail="Speaker name required")
    user_name = (config_store.get().user_name or "").strip().lower()
    is_user = 1 if speaker_name.lower() == user_name else 0
    label = "ME" if is_user else "REMOTE"

    conn = get_db()
    cur = conn.cursor()
    row = cur.execute("SELECT speaker_name FROM transcript_segments WHERE id = ? AND meeting_id = ?", (seg_id, meeting_id)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Segment not found")
    if scope == "all":
        ids = [r["id"] for r in cur.execute(
            "SELECT id FROM transcript_segments WHERE meeting_id = ? AND speaker_name = ?", (meeting_id, row["speaker_name"]))]
    else:
        ids = [seg_id]
    for sid in ids:
        cur.execute("UPDATE transcript_segments SET speaker_name = ?, is_user = ?, speaker_label = ? WHERE id = ?",
                    (speaker_name, is_user, label, sid))
        cur.execute("UPDATE transcript_fts SET speaker_name = ? WHERE segment_id = ?", (speaker_name, sid))
    conn.commit()
    conn.close()

    try:
        save_meeting_markdown_file(meeting_id)
        await intelligence_engine.generate_post_meeting_synthesis(meeting_id)
    except Exception:
        pass
    return {"updated": len(ids), "segment_ids": ids, "speaker_name": speaker_name, "is_user": is_user,
            "dominance": intelligence_engine.compute_dominance_ratio(meeting_id)}

# ----------------- Drift & Dominance -----------------
@app.get("/api/meetings/{meeting_id}/drift")
def get_meeting_drift(meeting_id: str):
    return {"drift_score": 0.0, "is_drifting": False, "status": "disabled"}

@app.get("/api/meetings/{meeting_id}/dominance")
def get_meeting_dominance(meeting_id: str):
    return intelligence_engine.compute_dominance_ratio(meeting_id)

# ----------------- Chatbot & Analysis -----------------
@app.post("/api/meetings/{meeting_id}/chat")
async def chat_with_meeting(meeting_id: str, req: ChatQueryReq):
    return await intelligence_engine.answer_chat_query(meeting_id, req.query, thinking=bool(req.thinking))

@app.get("/api/meetings/{meeting_id}/analysis")
def get_meeting_analysis(meeting_id: str):
    return intelligence_engine.get_meeting_analysis_data(meeting_id)

@app.get("/api/meetings/{meeting_id}/todos")
def get_meeting_todos(meeting_id: str):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(f"SELECT * FROM todos WHERE meeting_id = ? ORDER BY {TODO_ORDER}", (meeting_id,))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

@app.post("/api/meetings/{meeting_id}/generate-analysis")
async def generate_analysis(meeting_id: str):
    result = await intelligence_engine.generate_post_meeting_synthesis(meeting_id)
    # To-dos were regenerated with new ids (done / pinned state carried over); views must reload them
    await live_hub.broadcast({"type": "TODOS_REPLACED", "meeting_id": meeting_id})
    return result

class PinTodoReq(BaseModel):
    pinned: Optional[bool] = None  # omit to toggle

def _todo_payload(todo_id: str) -> Dict[str, Any]:
    conn = get_db()
    row = conn.execute("""
    SELECT t.*, m.title AS meeting_title FROM todos t LEFT JOIN meetings m ON t.meeting_id = m.id WHERE t.id = ?
    """, (todo_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Todo not found")
    return dict(row)

@app.post("/api/todos/{todo_id}/toggle")
async def toggle_todo(todo_id: str):
    todo = _todo_payload(todo_id)
    new_state = 0 if todo["completed"] == 1 else 1
    conn = get_db()
    conn.execute("UPDATE todos SET completed = ? WHERE id = ?", (new_state, todo_id))
    conn.commit()
    conn.close()
    todo = _todo_payload(todo_id)
    await live_hub.broadcast({"type": "TODO_UPDATED", "meeting_id": todo["meeting_id"], "todo": todo})
    return {
        "id": todo_id,
        "completed": bool(new_state),
        "status": "COMPLETED" if new_state else "PENDING",
        "todo": todo,
    }

@app.post("/api/todos/{todo_id}/pin")
async def pin_todo(todo_id: str, req: Optional[PinTodoReq] = None):
    """Pin a task so it stays at the top of its meeting and on the Home dashboard."""
    todo = _todo_payload(todo_id)
    pinned = (not bool(todo["pinned"])) if req is None or req.pinned is None else bool(req.pinned)
    conn = get_db()
    conn.execute("UPDATE todos SET pinned = ?, pinned_at = ? WHERE id = ?",
                 (1 if pinned else 0, datetime.now(timezone.utc).isoformat() if pinned else None, todo_id))
    conn.commit()
    conn.close()
    todo = _todo_payload(todo_id)
    try:
        save_meeting_markdown_file(todo["meeting_id"])
    except Exception:
        pass
    await live_hub.broadcast({"type": "TODO_UPDATED", "meeting_id": todo["meeting_id"], "todo": todo})
    return {"id": todo_id, "pinned": pinned, "todo": todo}

@app.get("/api/todos/pinned")
def list_pinned_todos():
    """Pinned tasks across every meeting, most recently pinned first."""
    conn = get_db()
    rows = [dict(r) for r in conn.execute("""
    SELECT t.*, m.title AS meeting_title FROM todos t LEFT JOIN meetings m ON t.meeting_id = m.id
    WHERE t.pinned = 1 ORDER BY t.completed ASC, t.pinned_at DESC
    """)]
    conn.close()
    return rows

# ----------------- Meeting Processing Pipeline -----------------
meeting_processing_state: Dict[str, Dict[str, Any]] = {}
processing_lock = asyncio.Lock()

def _set_meeting_status(meeting_id: str, status: str, error: str = ""):
    conn = get_db()
    conn.execute("UPDATE meetings SET status = ?, processing_error = ? WHERE id = ?", (status, error, meeting_id))
    conn.commit()
    conn.close()

async def _publish_progress(meeting_id: str, stage: str, step: int, progress: int, message: str, status: str = "processing", **extra):
    meeting_processing_state[meeting_id] = {
        "status": status, "stage": stage, "step": step, "total_steps": 4,
        "progress": progress, "message": message, "error": extra.pop("error", None), **extra
    }
    msg_type = {"completed": "MEETING_PROCESSED", "error": "PROCESSING_ERROR"}.get(status, "PROCESSING_PROGRESS")
    await live_hub.broadcast({"type": msg_type, "meeting_id": meeting_id, **meeting_processing_state[meeting_id]})

async def run_meeting_processing(meeting_id: str, model_name: Optional[str] = None, raw_notes: Optional[str] = None):
    model_name = model_name or config_store.get().whisper_model or "large-v3-turbo"
    await _publish_progress(meeting_id, "queued", 0, 2, "Waiting for the previous meeting to finish processing...")
    async with processing_lock:  # one Whisper job at a time keeps the Mac responsive
        try:
            _set_meeting_status(meeting_id, "processing")
            if raw_notes is not None:
                conn = get_db()
                conn.execute("UPDATE meetings SET raw_notes = ? WHERE id = ?", (raw_notes, meeting_id))
                conn.commit()
                conn.close()

            # Step 1: transcription (progress tracked from Whisper's position in the audio)
            duration = audio_pipeline.get_session_duration(meeting_id)
            if duration <= 0:
                raise RuntimeError("No audio was recorded for this session.")
            await _publish_progress(meeting_id, "transcription", 1, 5, f"Transcribing {int(duration // 60)}m {int(duration % 60)}s of audio with Whisper {model_name}...")

            fraction = {"value": 0.0}
            loop = asyncio.get_event_loop()
            job = loop.run_in_executor(
                None, lambda: audio_pipeline.transcribe_session_audio(meeting_id, model_name, lambda f: fraction.__setitem__("value", f))
            )
            last_sent = -1
            while not job.done():
                await asyncio.sleep(1.0)
                pct = 5 + int(fraction["value"] * 60)
                if pct != last_sent:
                    last_sent = pct
                    await _publish_progress(meeting_id, "transcription", 1, pct, f"Transcribing audio... {int(fraction['value'] * 100)}%")
            segments = await job

            conn = get_db()
            conn.execute("DELETE FROM transcript_segments WHERE meeting_id = ?", (meeting_id,))
            conn.execute("DELETE FROM transcript_fts WHERE meeting_id = ?", (meeting_id,))
            conn.execute("UPDATE meetings SET duration_sec = ? WHERE id = ?", (int(round(duration)), meeting_id))
            conn.commit()
            conn.close()
            for seg in segments:
                context_manager.add_segment(
                    meeting_id=meeting_id, speaker_label=seg["speaker_label"], speaker_name=seg["speaker_name"],
                    is_user=seg["is_user"], text=seg["text"], start_time=seg["start_time"], end_time=seg["end_time"],
                    timestamp_badge=seg["timestamp_badge"], raw_confidence=seg.get("raw_confidence", 0.95)
                )

            # Step 2: AI synthesis
            await _publish_progress(meeting_id, "intelligence_synthesis", 2, 70, f"Summarizing {len(segments)} transcript turns with {config_store.get().lm_studio_model}...")
            await intelligence_engine.generate_post_meeting_synthesis(meeting_id)

            # Step 3: notes enhancement (only when the user took notes)
            conn = get_db()
            row = conn.execute("SELECT raw_notes FROM meetings WHERE id = ?", (meeting_id,)).fetchone()
            conn.close()
            notes = (row["raw_notes"] if row else "") or ""
            if notes.strip() and segments:
                await _publish_progress(meeting_id, "notes_enhancement", 3, 88, "Enhancing your notes with transcript facts...")
                await intelligence_engine.enhance_user_notes(meeting_id, notes)

            # Step 4: export
            await _publish_progress(meeting_id, "markdown_export", 4, 96, "Writing meeting_notes.md...")
            conn = get_db()
            conn.execute("UPDATE meetings SET status = 'completed', processing_error = '', ended_at = COALESCE(ended_at, ?) WHERE id = ?",
                         (datetime.now(timezone.utc).isoformat(), meeting_id))
            conn.commit()
            conn.close()
            export_path = save_meeting_markdown_file(meeting_id)
            await _publish_progress(meeting_id, "completed", 4, 100, "Done — transcript, summary and notes are ready.",
                                    status="completed", export_path=export_path)
        except Exception as e:
            print(f"[MeetingProcessing] Error processing {meeting_id}: {e}")
            _set_meeting_status(meeting_id, "error", str(e))
            await _publish_progress(meeting_id, "error", 0, 0, f"Processing failed: {e}", status="error", error=str(e))

@app.post("/api/meetings/{meeting_id}/process")
async def process_meeting_endpoint(meeting_id: str, req: Optional[ProcessMeetingReq] = None):
    get_meeting(meeting_id)  # 404 if missing
    state = meeting_processing_state.get(meeting_id, {})
    if state.get("status") == "processing":
        return {"status": "already_processing", "meeting_id": meeting_id, "message": "This meeting is already being processed."}
    model = (req.model_name if req else None) or config_store.get().whisper_model
    asyncio.create_task(run_meeting_processing(meeting_id, model, req.raw_notes if req else None))
    return {"status": "started", "meeting_id": meeting_id, "model_name": model,
            "message": f"Processing started with Whisper {model}."}

@app.post("/api/meetings/{meeting_id}/finish")
async def finish_meeting(meeting_id: str, req: Optional[FinishMeetingReq] = None):
    """Called when a meeting ends: closes the recording and (by default) starts processing."""
    req = req or FinishMeetingReq()
    get_meeting(meeting_id)
    active_recordings.pop(meeting_id, None)
    duration = audio_pipeline.get_session_duration(meeting_id)
    conn = get_db()
    conn.execute("UPDATE meetings SET status = 'recorded', ended_at = ?, duration_sec = ? WHERE id = ?",
                 (datetime.now(timezone.utc).isoformat(), int(round(duration)), meeting_id))
    if req.raw_notes is not None:
        conn.execute("UPDATE meetings SET raw_notes = ? WHERE id = ?", (req.raw_notes, meeting_id))
    conn.commit()
    conn.close()
    await live_hub.broadcast({"type": "RECORDING_STOPPED", "meeting_id": meeting_id, "duration_sec": duration})

    already = meeting_processing_state.get(meeting_id, {}).get("status") == "processing"
    auto_process = config_store.get().auto_process_enabled if req.auto_process is None else req.auto_process
    if auto_process and duration >= 2.0 and not already:
        asyncio.create_task(run_meeting_processing(meeting_id))
        return {"status": "processing", "meeting_id": meeting_id, "duration_sec": duration}
    return {"status": "recorded", "meeting_id": meeting_id, "duration_sec": duration}

@app.post("/api/meetings/{meeting_id}/stop")
async def stop_meeting(meeting_id: str):
    """Stop from the dashboard: ask the recording extension to flush and finish; finish directly if none is connected."""
    meeting = get_meeting(meeting_id)
    if meeting["status"] != "recording":
        return {"status": meeting["status"], "meeting_id": meeting_id}
    ws = audio_sockets.get(meeting_id)
    if ws is not None:
        try:
            await ws.send_json({"status": "STOP_REQUESTED", "meeting_id": meeting_id})
            return {"status": "stopping", "meeting_id": meeting_id}
        except Exception:
            audio_sockets.pop(meeting_id, None)
    return await finish_meeting(meeting_id, FinishMeetingReq())

@app.get("/api/meetings/{meeting_id}/processing-status")
def get_processing_status(meeting_id: str):
    state = meeting_processing_state.get(meeting_id)
    if state:
        return {"meeting_id": meeting_id, **state}
    conn = get_db()
    row = conn.execute("SELECT status, processing_error FROM meetings WHERE id = ?", (meeting_id,)).fetchone()
    conn.close()
    status = row["status"] if row else "idle"
    if status == "completed":
        return {"meeting_id": meeting_id, "status": "completed", "stage": "completed", "step": 4, "total_steps": 4,
                "progress": 100, "message": "Meeting already processed."}
    if status == "error":
        return {"meeting_id": meeting_id, "status": "error", "stage": "error", "step": 0, "total_steps": 4,
                "progress": 0, "message": f"Processing failed: {row['processing_error']}", "error": row["processing_error"]}
    return {"meeting_id": meeting_id, "status": "idle", "stage": "ready", "step": 0, "total_steps": 4,
            "progress": 0, "message": "Ready to process"}

@app.get("/api/recording/active")
def get_active_recordings():
    return list(active_recordings.values())

WHISPER_CATALOG = [
    {"id": "large-v3-turbo", "name": "Whisper Large-v3-Turbo", "badge": "Fast • Recommended", "size": "1.5 GB", "recommended": True},
    {"id": "large-v3", "name": "Whisper Large-v3", "badge": "Highest Accuracy", "size": "2.9 GB", "recommended": False},
    {"id": "medium", "name": "Whisper Medium", "badge": "Balanced Multilingual", "size": "1.4 GB", "recommended": False},
    {"id": "small", "name": "Whisper Small", "badge": "Fast & Lightweight", "size": "466 MB", "recommended": False},
    {"id": "base", "name": "Whisper Base", "badge": "Ultra-Fast Standard", "size": "145 MB", "recommended": False},
]

def _is_whisper_model_downloaded(model_id: str) -> bool:
    models_dir = os.path.join(os.path.dirname(__file__), "models")
    local_dir = os.path.join(models_dir, model_id)
    if os.path.isdir(local_dir) and (
        os.path.exists(os.path.join(local_dir, "model.bin")) or
        os.path.exists(os.path.join(local_dir, ".downloaded"))
    ):
        return True
    hf_cache = os.path.expanduser(f"~/.cache/huggingface/hub/models--Systran--faster-whisper-{model_id}")
    if os.path.isdir(hf_cache):
        return True
    return False

class WhisperDownloadReq(BaseModel):
    model_id: str

@app.get("/api/models/whisper")
def list_whisper_models():
    models = []
    for item in WHISPER_CATALOG:
        downloaded = _is_whisper_model_downloaded(item["id"])
        models.append({
            **item,
            "downloaded": downloaded,
            "ready": downloaded,
            "status": "Downloaded (Local)" if downloaded else "Not Downloaded",
        })
    active = config_store.get().whisper_model or "large-v3-turbo"
    downloaded_ids = [m["id"] for m in models if m["downloaded"]]
    if active not in downloaded_ids and downloaded_ids:
        active = downloaded_ids[0]
    return {
        "models": models,
        "active_model": active
    }

@app.post("/api/models/whisper/download")
async def download_whisper_model(req: WhisperDownloadReq):
    model_id = req.model_id.strip()
    valid_ids = {m["id"] for m in WHISPER_CATALOG}
    if model_id not in valid_ids:
        raise HTTPException(status_code=400, detail=f"Unknown Whisper model: {model_id}")
    models_dir = os.path.join(os.path.dirname(__file__), "models", model_id)
    os.makedirs(models_dir, exist_ok=True)
    loop = asyncio.get_event_loop()
    def _do_download():
        from faster_whisper import download_model
        download_model(model_id, output_dir=models_dir)  # writes model.bin where the loader looks
    try:
        await loop.run_in_executor(None, _do_download)
    except Exception as e:
        shutil.rmtree(models_dir, ignore_errors=True)
        raise HTTPException(status_code=502, detail=f"Download failed: {e}")
    return {
        "status": "downloaded",
        "model_id": model_id,
        **list_whisper_models()
    }

@app.delete("/api/models/whisper/{model_id}")
def delete_whisper_model(model_id: str):
    models_dir = os.path.join(os.path.dirname(__file__), "models", model_id)
    if os.path.exists(models_dir) and os.path.isdir(models_dir):
        shutil.rmtree(models_dir, ignore_errors=True)
    return {
        "deleted": True,
        "model_id": model_id,
        **list_whisper_models()
    }

# ----------------- Individuals Dossier -----------------
@app.get("/api/individuals")
def list_individuals():
    return individual_tracker.get_all_individuals()

@app.get("/api/individuals/{person_id}")
def get_individual(person_id: str):
    dossier = individual_tracker.get_individual_dossier(person_id)
    if not dossier:
        raise HTTPException(status_code=404, detail="Person not found")
    return dossier

@app.put("/api/individuals/{person_id}/notes")
def update_individual_notes(person_id: str, req: NotesUpdateReq):
    individual_tracker.update_individual_notes(person_id, req.notes)
    return {"updated": True, "person_id": person_id}

@app.delete("/api/individuals/{person_id}")
def delete_individual_endpoint(person_id: str):
    conn = get_db()
    conn.execute("DELETE FROM individual_interactions WHERE individual_id = ?", (person_id,))
    conn.execute("DELETE FROM individuals WHERE id = ?", (person_id,))
    conn.commit()
    conn.close()
    return {"deleted": True, "person_id": person_id}

# ----------------- Behavioral Coach -----------------
@app.get("/api/coach")
def get_coaching_overview():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
    SELECT c.*, m.title as meeting_title
    FROM behavioral_coaching c
    LEFT JOIN meetings m ON c.meeting_id = m.id
    ORDER BY c.created_at DESC
    """)
    cards = [dict(r) for r in cur.fetchall()]

    if not cards:
        conn.close()
        return {
            "metrics": {
                "clarity_score": 0,
                "empathy_ratio": 0,
                "filler_words_per_min": 0,
                "interruption_rate": "0%"
            },
            "cards": []
        }

    avg_clarity = int(sum(c.get("clarity_score") or 0 for c in cards) / len(cards))
    avg_empathy = int(sum(c.get("empathy_score") or 0 for c in cards) / len(cards))

    # Speech habits measured from the user's own transcript lines
    user_rows = cur.execute("SELECT text, start_time, end_time FROM transcript_segments WHERE is_user = 1").fetchall()
    conn.close()
    fillers = re.compile(r"\b(um+|uh+|erm|you know|i mean|kind of|sort of|basically|actually|literally)\b", re.IGNORECASE)
    talk_min = sum(max(0.0, r["end_time"] - r["start_time"]) for r in user_rows) / 60.0
    filler_count = sum(len(fillers.findall(r["text"])) for r in user_rows)

    return {
        "metrics": {
            "clarity_score": avg_clarity,
            "empathy_ratio": avg_empathy,
            "filler_words_per_min": round(filler_count / talk_min, 1) if talk_min > 0 else 0,
            "talk_minutes": round(talk_min, 1)
        },
        "cards": cards
    }

# ----------------- Calendar Integration -----------------
@app.post("/api/calendar/export")
def export_calendar(req: CalendarExportReq):
    return calendar_service.generate_calendar_links(
        title=req.title,
        description=req.description or "",
        deadline_str=req.deadline,
        attendees=req.attendees
    )

@app.get("/api/calendar/download-ics")
def download_ics(title: str = Query(...), description: str = Query(""), deadline: Optional[str] = Query(None)):
    data = calendar_service.generate_calendar_links(title=title, description=description, deadline_str=deadline)
    filename = "meeting-item.ics"
    return Response(
        content=data["ics_content"],
        media_type="text/calendar",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

# ----------------- WebSockets: Live Feed & Audio Stream -----------------
@app.websocket("/ws/live")
async def websocket_live_endpoint(websocket: WebSocket):
    await live_hub.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Heartbeat ping/pong
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        live_hub.disconnect(websocket)
    except Exception:
        live_hub.disconnect(websocket)

# Recording sessions currently streaming audio, keyed by meeting id
active_recordings: Dict[str, Dict[str, Any]] = {}
audio_sockets: Dict[str, WebSocket] = {}
deleted_meetings: set = set()  # late audio for these is dropped instead of recreating the folder

@app.websocket("/ws/audio")
async def websocket_audio_endpoint(websocket: WebSocket):
    """
    Single-stream audio ingestion for one meeting session.
    Protocol:
      text   {"type":"INIT","meeting_id":..., "channels":2, "sample_rate":16000}
      binary interleaved int16 PCM frames (L = mic, R = meeting tab)
      text   {"type":"END"}  -> server replies {"status":"ENDED"} once everything is on disk
    The legacy {"type":"AUDIO_CHUNK","audio_data":<base64 wav>} message is still accepted.
    """
    await websocket.accept()
    meeting_id: Optional[str] = None
    channels = 2
    sample_rate = 16000
    last_level_broadcast = 0.0

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break

            if message.get("bytes") is not None:
                if not meeting_id or meeting_id in deleted_meetings:
                    continue
                levels = audio_pipeline.append_pcm(meeting_id, message["bytes"], channels, sample_rate)
                rec = active_recordings.setdefault(meeting_id, {"meeting_id": meeting_id, "seconds": 0.0})
                rec["seconds"] = audio_pipeline.get_session_duration(meeting_id)
                rec.update({"mic_level": levels["mic_level"], "tab_level": levels["tab_level"]})
                now = time.time()
                if now - last_level_broadcast > 0.25:
                    last_level_broadcast = now
                    await live_hub.broadcast({"type": "AUDIO_LEVEL", **rec, "amplitude": max(levels["mic_level"], levels["tab_level"])})
                continue

            if message.get("text") is None:
                continue
            payload = json.loads(message["text"])
            msg_type = payload.get("type", "AUDIO_CHUNK")

            if msg_type in ("INIT", "INIT_MEETING"):
                meeting_id = payload.get("meeting_id")
                channels = int(payload.get("channels", 2 if msg_type == "INIT" else 1))
                sample_rate = int(payload.get("sample_rate", 16000))
                if meeting_id:
                    audio_sockets[meeting_id] = websocket
                    _set_meeting_status(meeting_id, "recording")
                    seconds = audio_pipeline.get_session_duration(meeting_id)
                    active_recordings[meeting_id] = {"meeting_id": meeting_id, "seconds": seconds, "mic_level": 0, "tab_level": 0}
                    await live_hub.broadcast({"type": "RECORDING_STARTED", "meeting_id": meeting_id})
                await websocket.send_json({"status": "READY", "meeting_id": meeting_id})

            elif msg_type == "END":
                await websocket.send_json({"status": "ENDED", "meeting_id": meeting_id,
                                           "duration_sec": audio_pipeline.get_session_duration(meeting_id) if meeting_id else 0})

            elif msg_type == "AUDIO_CHUNK":
                chunk_meeting_id = payload.get("meeting_id") or meeting_id
                b64_audio = payload.get("audio_data", "")
                if chunk_meeting_id and b64_audio:
                    info = audio_pipeline.save_audio_chunk(base64.b64decode(b64_audio), chunk_meeting_id)
                    total = audio_pipeline.get_session_duration(chunk_meeting_id)
                    await websocket.send_json({"status": "RECORDED", "amplitude": info["amplitude"], "duration_sec": total})
                    await live_hub.broadcast({"type": "AUDIO_LEVEL", "meeting_id": chunk_meeting_id,
                                              "amplitude": info["amplitude"], "seconds": total})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[WebSocketAudio] Error: {e}")
    finally:
        if meeting_id and audio_sockets.get(meeting_id) is websocket:
            audio_sockets.pop(meeting_id, None)

# ----------------- Clear All Sessions -----------------
@app.post("/api/meetings/clear-all")
async def clear_all_endpoint():
    clear_all_data()
    await live_hub.broadcast({"type": "SESSIONS_CLEARED"})
    return {"status": "SUCCESS", "message": "All sessions cleared."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
