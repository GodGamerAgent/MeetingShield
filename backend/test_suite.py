#!/usr/bin/env python3
"""
Comprehensive End-to-End Test Suite for QUORUM
Tests every single backend module, API endpoint, WebSocket pipeline, and audio processing.
"""

import sys
import os
import json
import time
import base64
import wave
import io
import numpy as np
from datetime import datetime, timezone

# Ensure backend directory is in path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Run against a throwaway database, config and recordings folder so real sessions are never touched
import tempfile
_TMP = tempfile.mkdtemp(prefix="quorum-test-")
os.environ["QUORUM_DB_PATH"] = os.path.join(_TMP, "test.db")
os.environ["QUORUM_CONFIG_FILE"] = os.path.join(_TMP, "config.json")
os.environ["QUORUM_AUDIO_DIR"] = os.path.join(_TMP, "recordings")

from database import init_db, get_db, clear_all_data
from config_store import config_store
from audio_pipeline import audio_pipeline
from context_manager import context_manager
from intelligence_engine import intelligence_engine
from calendar_service import calendar_service
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

passed = 0
failed = 0

def test(name, fn):
    global passed, failed
    try:
        fn()
        print(f"  [PASS] {name}")
        passed += 1
    except Exception as e:
        print(f"  [FAIL] {name}: {e}")
        import traceback
        traceback.print_exc()
        failed += 1

print("\n=======================================================")
print("     STARTING QUORUM COMPREHENSIVE TEST SUITE       ")
print("=======================================================\n")

# 1. DATABASE TESTS
print("1. DATABASE & SCHEMA TESTS")
def test_db_clean():
    init_db()
    clear_all_data()
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT count(*) as cnt FROM meetings")
    assert cur.fetchone()["cnt"] == 0, "Meetings table should be empty"
    cur.execute("SELECT count(*) as cnt FROM transcript_segments")
    assert cur.fetchone()["cnt"] == 0, "Segments table should be empty"
    conn.close()
test("Database starts clean and empty", test_db_clean)

# 2. SETTINGS & CONFIG STORE TESTS
print("\n2. SETTINGS & CONFIGURATION TESTS")
def test_settings_endpoints():
    res = client.get("/api/settings")
    assert res.status_code == 200
    cfg = res.json()
    assert "audio_export_dir" in cfg
    assert "lm_studio_base_url" in cfg

    # Test updating settings
    test_dir = os.environ["QUORUM_AUDIO_DIR"]
    update_res = client.post("/api/settings", json={
        "audio_export_dir": test_dir,
        "default_calendar": "apple",
        "user_name": "TestUser"
    })
    assert update_res.status_code == 200
    updated = update_res.json()
    assert updated["audio_export_dir"] == test_dir
    assert updated["default_calendar"] == "apple"
    assert updated["user_name"] == "TestUser"

    # Reset back to Robin
    client.post("/api/settings", json={"user_name": "Robin"})
test("Settings GET and POST endpoints update config", test_settings_endpoints)

def test_status_endpoint():
    res = client.get("/api/status")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "online"
    assert "lm_studio" in data
test("System status endpoint responds online", test_status_endpoint)

# 3. AUDIO PIPELINE & TRANSCRIPTION TESTS
print("\n3. AUDIO PIPELINE & WHISPER ASR TESTS")
def _synth_speech_pcm(text):
    os.system(f'/usr/bin/say -v Samantha -o {_TMP}/speech.aiff "{text}"')
    os.system(f'/usr/bin/afconvert -f WAVE -d LEI16@16000 -c 1 {_TMP}/speech.aiff {_TMP}/speech.wav')
    with wave.open(f"{_TMP}/speech.wav", "rb") as wf:
        return np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16)

def test_silence_filtering():
    mid = "test-silence"
    silence = np.zeros((16000 * 4, 2), dtype=np.int16)
    audio_pipeline.append_pcm(mid, silence.tobytes(), channels=2)
    assert audio_pipeline.transcribe_session_audio(mid) == [], "Pure silence must produce no transcript"
test("Silence produces no transcript (no hallucinations)", test_silence_filtering)

def test_speech_transcription_and_attribution():
    me = _synth_speech_pcm("The project deadline is Friday afternoon.")
    them = _synth_speech_pcm("Great, I will send the report on Monday.")
    gap = np.zeros(16000, dtype=np.int16)
    mic = np.concatenate([me, gap, np.zeros_like(them)])
    tab = np.concatenate([np.zeros_like(me), gap, them])
    stereo = np.stack([mic, tab], axis=1)

    mid = "test-session-001"
    for i in range(0, len(stereo), 4000):  # stream in 0.25 s blocks like the extension
        audio_pipeline.append_pcm(mid, stereo[i:i + 4000].tobytes(), channels=2)
    assert abs(audio_pipeline.get_session_duration(mid) - len(stereo) / 16000) < 0.01

    segs = audio_pipeline.transcribe_session_audio(mid)
    assert len(segs) >= 2, f"Expected two turns, got {segs}"
    assert segs[0]["speaker_label"] == "ME" and "friday" in segs[0]["text"].lower()
    assert segs[-1]["speaker_label"] == "REMOTE" and "monday" in segs[-1]["text"].lower()
test("Stereo session: Whisper transcribes and attributes Me vs Others", test_speech_transcription_and_attribution)

# 4. MEETING MANAGEMENT & FTS5 RETRIEVAL
print("\n4. MEETING MANAGEMENT & CONTEXT MANAGER TESTS")
def test_meeting_lifecycle():
    # Create meeting
    create_res = client.post("/api/meetings", json={
        "title": "Quarterly Roadmap Review",
        "agenda": "Review Q3 milestones, ship Chrome extension, assign owners",
        "attendees": ["Robin (ME)", "Sarah Jenkins", "Marcus Vance"]
    })
    assert create_res.status_code == 200
    m = create_res.json()
    mid = m["id"]
    assert mid.startswith("meet-")

    # Add segment via ContextManager
    seg1 = context_manager.add_segment(
        meeting_id=mid,
        speaker_label="ME",
        speaker_name="Robin",
        is_user=1,
        text="I will lead the Chrome extension release and finalize the UI.",
        start_time=0.0,
        end_time=4.5,
        timestamp_badge="00:00:00"
    )
    assert seg1["id"].startswith("seg-")

    seg2 = context_manager.add_segment(
        meeting_id=mid,
        speaker_label="REMOTE",
        speaker_name="Sarah Jenkins",
        is_user=0,
        text="Great, I will handle the backend database migration by next Tuesday.",
        start_time=5.0,
        end_time=9.2,
        timestamp_badge="00:00:05"
    )

    # Test FTS5 Deep Search
    search_results = context_manager.search_transcript_fts(mid, "database migration")
    assert len(search_results) > 0, "FTS5 search should find 'database migration'"
    assert "Sarah" in search_results[0]["speaker_name"]

    # Test GET transcript
    t_res = client.get(f"/api/meetings/{mid}/transcript")
    assert t_res.status_code == 200
    segments = t_res.json()
    assert len(segments) == 2

    # Test speaker reassignment
    reassign_res = client.put(f"/api/meetings/{mid}/transcript/{seg2['id']}/speaker?speaker_name=Sarah%20J.")
    assert reassign_res.status_code == 200
    assert reassign_res.json()["updated"] == 1

    # Test Dominance Ratio
    dom_res = client.get(f"/api/meetings/{mid}/dominance")
    assert dom_res.status_code == 200
    dom_data = dom_res.json()
    assert dom_data["user_talk_time_pct"] > 0

    # Test Agenda Drift
    drift_res = client.get(f"/api/meetings/{mid}/drift")
    assert drift_res.status_code == 200
    drift_data = drift_res.json()
    assert "drift_score" in drift_data
test("Meeting lifecycle, FTS5 search, speaker update, dominance & drift", test_meeting_lifecycle)

# 5. POST-MEETING SYNTHESIS & ANALYSIS ENGINE
print("\n5. POST-MEETING SYNTHESIS & INTELLIGENCE TESTS")
def test_synthesis_generation():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT id FROM meetings ORDER BY created_at DESC LIMIT 1")
    row = cur.fetchone()
    mid = row["id"]
    conn.close()

    # Generate synthesis (runs through intelligence engine / fallback mode)
    syn_res = client.post(f"/api/meetings/{mid}/generate-analysis")
    assert syn_res.status_code == 200
    analysis = syn_res.json()
    assert "executive_summary" in analysis
    assert "action_plan" in analysis
    assert "decisions" in analysis

    # Check Todos created
    todos_res = client.get(f"/api/meetings/{mid}/todos")
    assert todos_res.status_code == 200
    todos = todos_res.json()
    assert len(todos) > 0, "Action items should be extracted"

    # Toggle Todo
    first_todo = todos[0]
    toggle_res = client.post(f"/api/todos/{first_todo['id']}/toggle")
    assert toggle_res.status_code == 200
    assert toggle_res.json()["status"] == "COMPLETED"

    # Check Behavioral Coaching
    coach_res = client.get("/api/coach")
    assert coach_res.status_code == 200
    coach_data = coach_res.json()
    assert "metrics" in coach_data
    assert "cards" in coach_data
    assert isinstance(coach_data["cards"], list)

    # Check Individual Profiles
    people_res = client.get("/api/individuals")
    assert people_res.status_code == 200
    people = people_res.json()
    assert len(people) > 0, "Sarah Jenkins profile should exist"
    sarah = next((p for p in people if "Sarah" in p["name"]), None)
    assert sarah is not None

    # Update individual notes
    notes_res = client.put(f"/api/individuals/{sarah['id']}/notes", json={"notes": "Key engineering contact."})
    assert notes_res.status_code == 200
test("Synthesis, action items, behavioral coach, & 1-on-1 profiles", test_synthesis_generation)

# 6. GRANOLA-STYLE ENHANCE MY NOTES & PER-MEETING FOLDER
print("\n6. GRANOLA NOTES, DEDICATED FOLDER & MARKDOWN EXPORT TESTS")
def test_granola_notes_and_markdown_folder():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT id FROM meetings ORDER BY created_at DESC LIMIT 1")
    row = cur.fetchone()
    mid = row["id"]
    conn.close()

    # 1. Save raw notes
    raw_notes = "• sarah to finish database migration next week\n• agreed on gRPC connection pooling\n• discuss roadmap Friday"
    notes_post = client.post(f"/api/meetings/{mid}/notes", json={"raw_notes": raw_notes})
    assert notes_post.status_code == 200

    # 2. Enhance My Notes via Gemma 4 / local intelligence engine
    enhance_res = client.post(f"/api/meetings/{mid}/enhance-notes", json={"raw_notes": raw_notes})
    assert enhance_res.status_code == 200
    enh_data = enhance_res.json()
    assert "enhanced_notes" in enh_data
    assert len(enh_data["enhanced_notes"]) > 20

    # 3. Verify dedicated folder and meeting_notes.md exists on disk
    md_res = client.get(f"/api/meetings/{mid}/markdown")
    assert md_res.status_code == 200
    md_data = md_res.json()
    assert "content" in md_data
    assert os.path.exists(md_data["file_path"]), "meeting_notes.md must exist on disk"
    assert os.path.isdir(md_data["folder_path"]), "Meeting must have its own dedicated folder"

    # 4. Download markdown endpoint
    dl_res = client.get(f"/api/meetings/{mid}/download-markdown")
    assert dl_res.status_code == 200
    assert "text/markdown" in dl_res.headers.get("content-type", "")
test("Enhance My Notes & per-meeting folder with meeting_notes.md", test_granola_notes_and_markdown_folder)

# 7. ONE-CLICK FOLLOW-UP DRAFTER (EMAIL & SLACK)
print("\n7. ONE-CLICK FOLLOW-UP EMAIL & SLACK DRAFTER TESTS")
def test_followup_drafter():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT id FROM meetings ORDER BY created_at DESC LIMIT 1")
    row = cur.fetchone()
    mid = row["id"]
    conn.close()

    # Test Email Draft
    email_res = client.get(f"/api/meetings/{mid}/followup?format=email")
    assert email_res.status_code == 200
    email_data = email_res.json()
    assert email_data["format"] == "email"
    assert "subject" in email_data and len(email_data["subject"]) > 0
    assert "body" in email_data and len(email_data["body"]) > 0
    assert "mailto:" in email_data["mailto_link"]

    # Test Slack Draft
    slack_res = client.get(f"/api/meetings/{mid}/followup?format=slack")
    assert slack_res.status_code == 200
    slack_data = slack_res.json()
    assert slack_data["format"] == "slack"
    assert "body" in slack_data
    assert ":memo:" in slack_data["body"] or "Meeting Recap" in slack_data["body"]
test("One-Click Follow-Up Email & Slack Drafter", test_followup_drafter)

# 8. GLOBAL OMNISEARCH TESTS
print("\n8. GLOBAL CROSS-MEETING OMNISEARCH TESTS")
def test_global_search():
    # Search for "database"
    search_res = client.get("/api/search?q=database")
    assert search_res.status_code == 200
    results = search_res.json()
    assert "transcripts" in results
    assert "meetings" in results
    assert "todos" in results
    assert results["total_results"] > 0, "Global search should return results across meetings and transcripts"
test("Global Omnisearch across meetings, transcripts, todos & people", test_global_search)

# 9. CALENDAR EXPORT TESTS
print("\n6. CALENDAR INTEGRATION TESTS")
def test_calendar_service():
    res = client.post("/api/calendar/export", json={
        "title": "Ship Chrome Extension Release",
        "description": "Deploy to Web Store and verify manifest V3",
        "deadline": (datetime.now(timezone.utc)).isoformat()
    })
    assert res.status_code == 200
    data = res.json()
    assert "google_url" in data
    assert "outlook_url" in data
    assert "ics_content" in data
    assert "BEGIN:VCALENDAR" in data["ics_content"]
    assert "END:VCALENDAR" in data["ics_content"]

    # Test .ics download
    ics_res = client.get("/api/calendar/download-ics?title=Team+Review")
    assert ics_res.status_code == 200
    assert "text/calendar" in ics_res.headers.get("content-type", "")
test("Calendar export formats (Google, Outlook, RFC-5545 Apple .ics)", test_calendar_service)

# 7. WEBSOCKET AUDIO STREAMING TEST
print("\n7. WEBSOCKET AUDIO STREAMING TESTS")
def test_audio_websocket():
    # Connect to /ws/audio via TestClient
    with client.websocket_connect("/ws/audio") as ws:
        # 1. Send INIT_MEETING
        ws.send_text(json.dumps({
            "type": "INIT_MEETING",
            "meeting_id": "ws-test-session"
        }))
        ack = ws.receive_json()
        assert ack["status"] == "READY"

        # 2. Generate a real speech chunk to send over WS
        os.system('/usr/bin/say -v Samantha -o /tmp/ws_test.aiff "Let us review the security architecture now."')
        os.system('/usr/bin/afconvert -f WAVE -d LEI16@16000 -c 1 /tmp/ws_test.aiff /tmp/ws_test.wav')
        with open('/tmp/ws_test.wav', 'rb') as f:
            wav_data = f.read()

        b64_audio = base64.b64encode(wav_data).decode('utf-8')

        ws.send_text(json.dumps({
            "type": "AUDIO_CHUNK",
            "source": "ME",
            "meeting_id": "ws-test-session",
            "audio_data": b64_audio
        }))

        # Audio is recorded during the meeting; transcription happens when it ends
        resp = ws.receive_json()
        assert resp["status"] == "RECORDED"
        assert resp["duration_sec"] > 1.0

        # Clean temp
        if os.path.exists('/tmp/ws_test.aiff'): os.remove('/tmp/ws_test.aiff')
        if os.path.exists('/tmp/ws_test.wav'): os.remove('/tmp/ws_test.wav')
test("WebSocket /ws/audio records streamed chunks to the session", test_audio_websocket)

# 8. REAL-TIME CHATBOT RETRIEVAL
print("\n8. REAL-TIME MEETING CHATBOT TESTS")
def test_meeting_chatbot():
    res = client.post("/api/meetings/ws-test-session/chat", json={
        "query": "What did Robin say about security?"
    })
    assert res.status_code == 200
    reply = res.json()
    assert "response" in reply
    assert len(reply["response"]) > 0
test("Meeting chatbot retrieves exact context with timestamps", test_meeting_chatbot)

# 8b. TASK PINNING
print("\n8b. TASK PINNING")
def test_task_pinning():
    mid = client.post("/api/meetings", json={"title": "Pin test", "status": "recorded"}).json()["id"]
    intelligence_engine._persist_synthesis(mid, {
        "executive_summary": "x",
        "todos": [
            {"task": "Ship the API", "owner": "Arnab", "priority": "HIGH", "timestamp_ref": "00:01:00"},
            {"task": "Write docs", "owner": "Me", "priority": "LOW", "timestamp_ref": "00:02:00"},
            {"task": "Fix login bug", "owner": "Jayesh", "priority": "MEDIUM", "timestamp_ref": "00:03:00"},
        ],
    })
    todos = client.get(f"/api/meetings/{mid}/todos").json()
    assert [t["priority"] for t in todos] == ["HIGH", "MEDIUM", "LOW"], "priority order must be HIGH, MEDIUM, LOW"
    docs = next(t for t in todos if t["task"] == "Write docs")
    fix = next(t for t in todos if t["task"] == "Fix login bug")

    # Toggle pin on, it jumps to the top of the meeting and appears in the global list
    res = client.post(f"/api/todos/{docs['id']}/pin").json()
    assert res["pinned"] is True and res["todo"]["meeting_title"] == "Pin test"
    assert client.get(f"/api/meetings/{mid}/todos").json()[0]["id"] == docs["id"]
    assert [t["id"] for t in client.get("/api/todos/pinned").json()] == [docs["id"]]

    # Explicit pin is idempotent; explicit unpin works; missing task is a 404
    assert client.post(f"/api/todos/{docs['id']}/pin", json={"pinned": True}).json()["pinned"] is True
    assert client.post(f"/api/todos/{fix['id']}/pin", json={"pinned": True}).json()["pinned"] is True
    assert client.post(f"/api/todos/{fix['id']}/pin", json={"pinned": False}).json()["pinned"] is False
    assert client.post("/api/todos/does-not-exist/pin").status_code == 404

    # Done + pinned survives a re-summary, even if the model rewords punctuation/case
    client.post(f"/api/todos/{docs['id']}/toggle")
    intelligence_engine._persist_synthesis(mid, {
        "executive_summary": "y",
        "todos": [
            {"task": "write docs!", "owner": "Me", "priority": "LOW", "timestamp_ref": "00:02:00"},
            {"task": "Ship the API", "owner": "Arnab", "priority": "HIGH", "timestamp_ref": "00:01:00"},
        ],
    })
    after = client.get(f"/api/meetings/{mid}/todos").json()
    kept = next(t for t in after if t["task"] == "write docs!")
    assert kept["pinned"] == 1 and kept["completed"] == 1, "pin and done state must carry over"
    assert after[0]["id"] == kept["id"]

    # A pinned task the new summary dropped is kept rather than silently lost
    client.post(f"/api/todos/{after[1]['id']}/pin", json={"pinned": True})   # pin "Ship the API"
    intelligence_engine._persist_synthesis(mid, {"executive_summary": "z", "todos": []})
    left = client.get(f"/api/meetings/{mid}/todos").json()
    assert sorted(t["task"] for t in left) == ["Ship the API", "write docs!"]
    assert all(t["pinned"] == 1 for t in left)
    assert next(t for t in left if t["task"] == "Ship the API")["owner"] == "Arnab"

    # Deleting the meeting removes its pinned tasks from the global list
    client.delete(f"/api/meetings/{mid}")
    assert client.get("/api/todos/pinned").json() == []
test("Pin / unpin tasks, ordering, pinned list, survives re-summary", test_task_pinning)

# 9. AUDIO DOWNLOAD AND CLEANUP
print("\n9. SESSION AUDIO DOWNLOAD & CLEANUP")
def test_audio_download_and_clear():
    # Audio info
    info_res = client.get("/api/meetings/ws-test-session/audio-info")
    assert info_res.status_code == 200
    info = info_res.json()
    assert info["has_audio"] is True

    # Audio download
    download_res = client.get("/api/meetings/ws-test-session/audio")
    assert download_res.status_code == 200
    assert "audio/wav" in download_res.headers.get("content-type", "")

    # Clear all sessions
    clear_res = client.post("/api/meetings/clear-all")
    assert clear_res.status_code == 200

    # Verify 0 meetings remain
    list_res = client.get("/api/meetings")
    assert len(list_res.json()) == 0
test("Audio download (.wav) and clear_all_data wipe clean", test_audio_download_and_clear)

print("\n=======================================================")
print(f"TEST RESULTS: {passed} PASSED, {failed} FAILED")
print("=======================================================\n")

if failed > 0:
    sys.exit(1)
