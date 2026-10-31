import sqlite3
import json
import uuid
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from database import get_db

class IndividualTracker:
    def __init__(self):
        pass

    def get_all_individuals(self) -> List[Dict[str, Any]]:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
        SELECT * FROM individuals
        ORDER BY last_met DESC, total_meetings DESC
        """)
        rows = cur.fetchall()
        conn.close()
        return [dict(r) for r in rows]

    def get_individual_dossier(self, person_id: str) -> Optional[Dict[str, Any]]:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT * FROM individuals WHERE id = ?", (person_id,))
        person = cur.fetchone()

        if not person:
            conn.close()
            return None

        p_dict = dict(person)

        # Fetch interactions
        cur.execute("""
        SELECT i.*, m.title as meeting_title
        FROM individual_interactions i
        LEFT JOIN meetings m ON i.meeting_id = m.id
        WHERE i.individual_id = ?
        ORDER BY i.created_at DESC
        """, (person_id,))
        interactions = [dict(r) for r in cur.fetchall()]

        # Fetch quotes / segments spoken by this person across all meetings
        cur.execute("""
        SELECT s.id, s.meeting_id, s.text, s.timestamp_badge, s.start_time, m.title as meeting_title
        FROM transcript_segments s
        JOIN meetings m ON s.meeting_id = m.id
        WHERE s.speaker_name = ?
        ORDER BY s.created_at DESC
        LIMIT 25
        """, (person["name"],))
        spoken_segments = [dict(r) for r in cur.fetchall()]

        conn.close()

        p_dict["interactions"] = interactions
        p_dict["spoken_segments"] = spoken_segments
        return p_dict

    def update_individual_notes(self, person_id: str, notes: str) -> bool:
        conn = get_db()
        cur = conn.cursor()
        now_iso = datetime.now(timezone.utc).isoformat()
        cur.execute("""
        UPDATE individuals
        SET notes = ?, updated_at = ?
        WHERE id = ?
        """, (notes, now_iso, person_id))
        conn.commit()
        conn.close()
        return True

    def record_interaction(
        self,
        name: str,
        role: str,
        meeting_id: str,
        timestamp_ref: str,
        quote: str,
        promises_by_them: Optional[str] = None,
        promises_by_user: Optional[str] = None,
        topic: Optional[str] = None,
        talk_time_sec: int = 0
    ) -> Dict[str, Any]:
        conn = get_db()
        cur = conn.cursor()
        now_iso = datetime.now(timezone.utc).isoformat()

        # Check if individual exists
        cur.execute("SELECT * FROM individuals WHERE name = ?", (name,))
        person = cur.fetchone()

        if person:
            person_id = person["id"]
            new_total = person["total_meetings"] + 1
            new_talk_time = person["talk_time_sec_total"] + talk_time_sec
            cur.execute("""
            UPDATE individuals
            SET last_met = ?, total_meetings = ?, talk_time_sec_total = ?, updated_at = ?
            WHERE id = ?
            """, (now_iso, new_total, new_talk_time, now_iso, person_id))
        else:
            person_id = f"ind-{uuid.uuid4().hex[:8]}"
            cur.execute("""
            INSERT INTO individuals (id, name, role, email, avatar_url, first_met, last_met, total_meetings, talk_time_sec_total, reliability_score, communication_cheat_sheet, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                person_id, name, role or "Colleague", "",
                "",
                now_iso, now_iso, 1, talk_time_sec, 85,
                f"Prefers concise data and direct communication. Respects clear deadline boundaries.",
                "", now_iso, now_iso
            ))

        # Record interaction
        act_id = f"act-{uuid.uuid4().hex[:8]}"
        cur.execute("""
        INSERT INTO individual_interactions (id, individual_id, meeting_id, timestamp_ref, quote, promises_by_them, promises_by_user, topic, sentiment, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            act_id, person_id, meeting_id, timestamp_ref, quote,
            promises_by_them or "", promises_by_user or "", topic or "General Discussion",
            "positive", now_iso
        ))

        conn.commit()
        conn.close()
        return {"id": act_id, "individual_id": person_id}

individual_tracker = IndividualTracker()
