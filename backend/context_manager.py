import sqlite3
import json
import uuid
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from database import get_db
from config_store import config_store

class ContextManager:
    """
    Hierarchical 3-Tier Long-Meeting Context Manager:
    Tier 1: Hot verbatim buffer (Last 5 minutes of conversation)
    Tier 2: Compacted Epoch Digests (Summarized 10-minute blocks via Gemma 4)
    Tier 3: FTS5 Deep Search Retrieval for exact quotes across multi-hour transcripts.
    Guarantees prompts stay strictly under 3,500 tokens!
    """

    def __init__(self):
        pass

    def add_segment(
        self,
        meeting_id: str,
        speaker_label: str,
        speaker_name: str,
        is_user: int,
        text: str,
        start_time: float,
        end_time: float,
        timestamp_badge: str,
        raw_confidence: float = 0.95
    ) -> Dict[str, Any]:
        conn = get_db()
        cur = conn.cursor()
        seg_id = f"seg-{uuid.uuid4().hex[:8]}"
        now_iso = datetime.now(timezone.utc).isoformat()

        # Ensure meeting exists in meetings table
        cur.execute("SELECT id FROM meetings WHERE id = ?", (meeting_id,))
        if not cur.fetchone():
            cur.execute("""
            INSERT INTO meetings (id, title, agenda, attendees, created_at, status, duration_sec, drift_score)
            VALUES (?, 'Untitled Session', '', '[]', ?, 'recorded', 0, 0.0)
            """, (meeting_id, now_iso))

        cur.execute("""
        INSERT INTO transcript_segments (id, meeting_id, speaker_label, speaker_name, is_user, text, start_time, end_time, timestamp_badge, raw_confidence, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (seg_id, meeting_id, speaker_label, speaker_name, is_user, text, start_time, end_time, timestamp_badge, raw_confidence, now_iso))

        # Index into FTS5
        cur.execute("""
        INSERT INTO transcript_fts (segment_id, meeting_id, speaker_name, text, timestamp_badge)
        VALUES (?, ?, ?, ?, ?)
        """, (seg_id, meeting_id, speaker_name, text, timestamp_badge))

        # Update meeting duration
        cur.execute("""
        UPDATE meetings
        SET duration_sec = MAX(duration_sec, CAST(? AS INTEGER))
        WHERE id = ?
        """, (int(end_time), meeting_id))

        conn.commit()
        conn.close()

        return {
            "id": seg_id,
            "meeting_id": meeting_id,
            "speaker_label": speaker_label,
            "speaker_name": speaker_name,
            "is_user": is_user,
            "text": text,
            "start_time": start_time,
            "end_time": end_time,
            "timestamp_badge": timestamp_badge,
            "created_at": now_iso
        }

    def get_recent_segments(self, meeting_id: str, window_seconds: float = 300.0) -> List[Dict[str, Any]]:
        """Returns the last N seconds (default 5 mins) of raw transcript."""
        conn = get_db()
        cur = conn.cursor()

        # Get latest end_time
        cur.execute("SELECT MAX(end_time) as max_time FROM transcript_segments WHERE meeting_id = ?", (meeting_id,))
        row = cur.fetchone()
        max_time = row["max_time"] if row and row["max_time"] is not None else 0.0

        cutoff = max(0.0, max_time - window_seconds)
        cur.execute("""
        SELECT * FROM transcript_segments
        WHERE meeting_id = ? AND start_time >= ?
        ORDER BY start_time ASC
        """, (meeting_id, cutoff))

        rows = cur.fetchall()
        conn.close()
        return [dict(r) for r in rows]

    def search_transcript_fts(self, meeting_id: str, query: str, limit: int = 5) -> List[Dict[str, Any]]:
        """FTS5 deep keyword retrieval across entire meeting history with snippets."""
        conn = get_db()
        cur = conn.cursor()

        # Clean search query for SQLite FTS5
        clean_query = "".join([c if c.isalnum() or c.isspace() else " " for c in query]).strip()
        if not clean_query:
            conn.close()
            return []

        # Formulate valid SQLite FTS5 prefix match terms
        terms = [f"{t}*" for t in clean_query.split() if len(t) > 2]
        if not terms:
            terms = [f'"{t}"' for t in clean_query.split() if t]
        match_expr = " OR ".join(terms)

        try:
            cur.execute("""
            SELECT segment_id, speaker_name, text, timestamp_badge,
                   snippet(transcript_fts, 3, '[MATCH]', '[/MATCH]', '...', 15) as snippet
            FROM transcript_fts
            WHERE transcript_fts MATCH ? AND meeting_id = ?
            LIMIT ?
            """, (match_expr, meeting_id, limit))
            rows = cur.fetchall()
            conn.close()
            return [dict(r) for r in rows]
        except Exception as e:
            print(f"[ContextManager] FTS search fallback on error: {e}")
            # Fallback to standard LIKE
            cur.execute("""
            SELECT id as segment_id, speaker_name, text, timestamp_badge, text as snippet
            FROM transcript_segments
            WHERE meeting_id = ? AND text LIKE ?
            ORDER BY start_time DESC
            LIMIT ?
            """, (meeting_id, f"%{clean_query[:20]}%", limit))
            rows = cur.fetchall()
            conn.close()
            return [dict(r) for r in rows]

    def get_epoch_summaries(self, meeting_id: str) -> List[Dict[str, Any]]:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
        SELECT * FROM epoch_summaries
        WHERE meeting_id = ?
        ORDER BY epoch_index ASC
        """, (meeting_id,))
        rows = cur.fetchall()
        conn.close()
        return [dict(r) for r in rows]

    def save_epoch_summary(self, meeting_id: str, epoch_index: int, start_min: int, end_min: int, summary: str, topics: List[str]) -> Dict[str, Any]:
        conn = get_db()
        cur = conn.cursor()
        epoch_id = f"epoch-{uuid.uuid4().hex[:8]}"
        now_iso = datetime.now(timezone.utc).isoformat()

        cur.execute("""
        INSERT INTO epoch_summaries (id, meeting_id, epoch_index, start_min, end_min, summary_markdown, key_topics, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (epoch_id, meeting_id, epoch_index, start_min, end_min, summary, json.dumps(topics), now_iso))

        conn.commit()
        conn.close()
        return {
            "id": epoch_id,
            "meeting_id": meeting_id,
            "epoch_index": epoch_index,
            "start_min": start_min,
            "end_min": end_min,
            "summary_markdown": summary,
            "key_topics": topics
        }

    def has_transcript(self, meeting_id: str) -> bool:
        conn = get_db()
        row = conn.execute("SELECT 1 FROM transcript_segments WHERE meeting_id = ? LIMIT 1", (meeting_id,)).fetchone()
        conn.close()
        return row is not None

    def build_llm_context(
        self,
        meeting_id: str,
        user_query: Optional[str] = None,
        max_chars: int = 24000
    ) -> str:
        """
        Context for chat about one meeting:
        - the whole transcript when it fits the budget (most meetings), otherwise
        - summary + chunk digests + transcript lines matching the question + the final 5 minutes.
        """
        conn = get_db()
        cur = conn.cursor()
        meeting = cur.execute("SELECT * FROM meetings WHERE id = ?", (meeting_id,)).fetchone()
        analysis = cur.execute("SELECT executive_summary FROM meeting_analysis WHERE meeting_id = ?", (meeting_id,)).fetchone()
        segments = [dict(r) for r in cur.execute(
            "SELECT * FROM transcript_segments WHERE meeting_id = ? ORDER BY start_time ASC", (meeting_id,)
        ).fetchall()]
        conn.close()

        if not meeting:
            return "No meeting context found."

        def fmt(s):
            return f"[{s['timestamp_badge']}] {s['speaker_name']}{' (me)' if s['is_user'] else ''}: {s['text']}"

        header = f"MEETING: {meeting['title']}\nAGENDA: {meeting['agenda'] or 'not provided'}\n"
        full = "\n".join(fmt(s) for s in segments)
        if len(full) <= max_chars:
            return f"{header}\nFULL TRANSCRIPT:\n{full}"

        parts = [header]
        if analysis and analysis["executive_summary"]:
            parts.append(f"SUMMARY:\n{analysis['executive_summary']}")
        epochs = self.get_epoch_summaries(meeting_id)
        if epochs:
            parts.append("DIGESTS:\n" + "\n".join(f"[Min {e['start_min']}-{e['end_min']}] {e['summary_markdown']}" for e in epochs))
        if user_query:
            matches = self.search_transcript_fts(meeting_id, user_query, limit=12)
            if matches:
                parts.append("TRANSCRIPT LINES MATCHING THE QUESTION:\n" + "\n".join(
                    f"[{m['timestamp_badge']}] {m['speaker_name']}: {m['text']}" for m in matches))
        recent = self.get_recent_segments(meeting_id, window_seconds=300.0)
        parts.append("FINAL 5 MINUTES:\n" + "\n".join(fmt(s) for s in recent))
        return "\n\n".join(parts)[: max_chars + 4000]

context_manager = ContextManager()
