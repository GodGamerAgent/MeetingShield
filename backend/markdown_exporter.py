import os
import re
import json
from datetime import datetime, timezone
from typing import Dict, Any, Optional
from database import get_db
from config_store import config_store
from audio_pipeline import audio_pipeline

def generate_meeting_markdown(meeting_id: str) -> str:
    """
    Generates a structured, rich GitHub-flavored Markdown document for a meeting session.
    Includes:
    - Session Header & Metadata (Title, Date, Duration, Attendees, Agenda)
    - ✍️ My Raw Notes (Handwritten during meeting)
    - ✨ Enhanced Notes (AI Augmented with Timestamps via Gemma 4)
    - 🏛️ Executive Summary, Decisions, and Rejected Alternatives
    - 🎯 Phased Action Plan & Deliverables
    - ✅ Prioritized Action Items (To-Dos)
    - 💡 Things to Remember (Memory Cards)
    - 🎙️ Personal Behavioral & Response Coaching (ME)
    - 📜 Full Verbatim Transcript with exact [HH:MM:SS] timestamps
    """
    conn = get_db()
    cur = conn.cursor()

    # 1. Meeting details
    cur.execute("SELECT * FROM meetings WHERE id = ?", (meeting_id,))
    meeting = cur.fetchone()
    if not meeting:
        conn.close()
        return f"# Meeting Not Found: {meeting_id}\n"

    m_dict = dict(meeting)
    title = m_dict.get("title", "Live Meeting Session")
    agenda = m_dict.get("agenda", "General Meeting Discussion")
    created_at = m_dict.get("created_at", datetime.now(timezone.utc).isoformat())
    duration_sec = m_dict.get("duration_sec", 0)
    duration_min = round(duration_sec / 60.0, 1) if duration_sec else 0
    drift_score = round(m_dict.get("drift_score", 0.0), 1)

    try:
        attendees = json.loads(m_dict.get("attendees") or "[]")
    except Exception:
        attendees = [m_dict.get("attendees")] if m_dict.get("attendees") else ["Robin (ME)"]
    attendees_str = ", ".join(attendees) if attendees else "Robin (ME)"

    raw_notes = (m_dict.get("raw_notes") or "").strip()
    enhanced_notes = (m_dict.get("enhanced_notes") or "").strip()

    # 2. Analysis & Synthesis
    cur.execute("SELECT * FROM meeting_analysis WHERE meeting_id = ?", (meeting_id,))
    analysis_row = cur.fetchone()
    analysis = dict(analysis_row) if analysis_row else {}

    exec_summary = analysis.get("executive_summary", "No executive summary generated yet.")
    try:
        decisions = json.loads(analysis.get("decisions_json") or "[]")
    except Exception:
        decisions = []
    try:
        rejected = json.loads(analysis.get("rejected_alternatives_json") or "[]")
    except Exception:
        rejected = []
    try:
        action_plan = json.loads(analysis.get("action_plan_json") or "[]")
    except Exception:
        action_plan = []

    # 3. Todos
    cur.execute("""SELECT * FROM todos WHERE meeting_id = ? ORDER BY pinned DESC, completed ASC,
                   CASE priority WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END, timestamp_ref ASC""", (meeting_id,))
    todos = [dict(r) for r in cur.fetchall()]

    # 4. Things to remember
    cur.execute("SELECT * FROM things_to_remember WHERE meeting_id = ?", (meeting_id,))
    memories = [dict(r) for r in cur.fetchall()]

    # 5. Behavioral coaching
    cur.execute("SELECT * FROM behavioral_coaching WHERE meeting_id = ? ORDER BY timestamp_ref ASC", (meeting_id,))
    coaching = [dict(r) for r in cur.fetchall()]

    # 6. Transcript
    cur.execute("SELECT * FROM transcript_segments WHERE meeting_id = ? ORDER BY start_time ASC", (meeting_id,))
    segments = [dict(r) for r in cur.fetchall()]

    conn.close()

    # Build Markdown
    md_lines = []
    md_lines.append(f"# 📋 Meeting Notes: {title}\n")
    md_lines.append(f"- **Session ID:** `{meeting_id}`")
    md_lines.append(f"- **Date & Time:** {created_at}")
    md_lines.append(f"- **Duration:** {duration_min} minutes ({duration_sec} seconds)")
    md_lines.append(f"- **Attendees:** {attendees_str}")
    md_lines.append(f"- **Meeting Agenda:** {agenda}\n")
    md_lines.append("---\n")

    # Raw Notes Section
    md_lines.append("## ✍️ My Raw Notes (Handwritten during meeting)\n")
    if raw_notes:
        md_lines.append(f"{raw_notes}\n")
    else:
        md_lines.append("_No raw notes taken during this session._\n")
    md_lines.append("---\n")

    # Enhanced Notes Section (Granola-style)
    md_lines.append("## ✨ Enhanced Notes (AI Augmented via Gemma 4)\n")
    if enhanced_notes:
        clean_enhanced = re.sub(r'<thought>.*?</thought>', '', enhanced_notes, flags=re.DOTALL).strip()
        md_lines.append(f"{clean_enhanced}\n")
    else:
        md_lines.append("_Click 'Enhance My Notes' in the dashboard to augment your notes with transcript facts and timestamps._\n")
    md_lines.append("---\n")

    # Executive Summary
    md_lines.append("## 🏛️ Executive Summary\n")
    md_lines.append(f"{exec_summary}\n")

    # Decisions
    md_lines.append("### Key Approved Decisions")
    if decisions:
        for d in decisions:
            md_lines.append(f"- [x] **{d}**")
    else:
        md_lines.append("- _No formal decisions recorded._")
    md_lines.append("")

    # Rejected Alternatives
    md_lines.append("### Rejected Alternatives & Trade-offs")
    if rejected:
        for r in rejected:
            md_lines.append(f"- ❌ {r}")
    else:
        md_lines.append("- _No rejected alternatives logged._")
    md_lines.append("\n---\n")

    # Phased Action Plan
    md_lines.append("## 🎯 Phased Action Plan & Deliverables\n")
    if action_plan:
        for phase in action_plan:
            p_name = phase.get("phase", "Phase")
            p_details = phase.get("details", "")
            md_lines.append(f"### {p_name}")
            md_lines.append(f"{p_details}\n")
    else:
        md_lines.append("_Action plan will be extracted during post-meeting synthesis._\n")
    md_lines.append("---\n")

    # Prioritized To-Dos
    md_lines.append("## ✅ Prioritized Action Items (To-Dos)\n")
    if todos:
        for t in todos:
            check = "[x]" if t.get("completed") else "[ ]"
            prio = t.get("priority", "MEDIUM")
            task = t.get("task", "")
            owner = t.get("owner", "Unassigned")
            deadline = t.get("deadline", "Next Sprint")
            badge = t.get("timestamp_ref", "00:00:00")
            pin = "⭐ " if t.get("pinned") else ""
            md_lines.append(f"- {check} {pin}**[{prio}]** {task} — *Owner:* **{owner}** | *Deadline:* {deadline} (`[{badge}]`)")
    else:
        md_lines.append("- [ ] _No action items logged yet._")
    md_lines.append("\n---\n")

    # Things to Remember
    md_lines.append("## 💡 Things to Remember (Memory Cards)\n")
    if memories:
        for m in memories:
            fact = m.get("fact", "")
            cat = m.get("category", "Key Detail")
            person = m.get("person", "Team")
            badge = m.get("timestamp_ref", "00:00:00")
            md_lines.append(f"- 📌 **{fact}** (`{cat}`) — Mentioned by **{person}** at `[{badge}]`")
    else:
        md_lines.append("_No sticky memories extracted yet._")
    md_lines.append("\n---\n")

    # Personal Behavioral Coaching
    md_lines.append("## 🎙️ Personal Behavioral & Response Coaching (ME)\n")
    if coaching:
        for c in coaching:
            badge = c.get("timestamp_ref", "00:00:00")
            said = c.get("what_you_said", "")
            tone = c.get("tone_detected", "")
            impact = c.get("impact_analysis", "")
            better = c.get("better_response", "")
            principle = c.get("coaching_principle", "")
            md_lines.append(f"### `[{badge}]` Phrase Audit")
            md_lines.append(f"- **What You Said:** \"{said}\"")
            md_lines.append(f"- **Tone Detected:** `{tone}`")
            md_lines.append(f"- **Impact Analysis:** {impact}")
            md_lines.append(f"- **Recommended Response:** \"{better}\"")
            md_lines.append(f"- **Strategic Principle:** *{principle}*\n")
    else:
        md_lines.append("_Behavioral coaching evaluates user speech segments during synthesis._\n")
    md_lines.append("---\n")

    # Full Verbatim Transcript
    md_lines.append("## 📜 Full Verbatim Transcript\n")
    if segments:
        for s in segments:
            badge = s.get("timestamp_badge", "00:00:00")
            name = s.get("speaker_name", "Speaker")
            is_u = "**(ME)**" if s.get("is_user") else ""
            text = s.get("text", "")
            md_lines.append(f"- `[{badge}]` **{name} {is_u}:** {text}")
    else:
        md_lines.append("_Transcript is empty._")
    md_lines.append("\n---\n")
    md_lines.append("_Generated on-device by Quorum_\n")

    return "\n".join(md_lines)

def save_meeting_markdown_file(meeting_id: str) -> str:
    """
    Saves the complete meeting markdown document to the dedicated meeting directory:
    {audio_export_dir}/{meeting_id}/meeting_notes.md
    """
    meeting_dir = audio_pipeline.get_meeting_dir(meeting_id)
    filepath = os.path.join(meeting_dir, "meeting_notes.md")

    content = generate_meeting_markdown(meeting_id)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)

    return filepath

def get_meeting_markdown_path(meeting_id: str) -> Optional[str]:
    cfg = config_store.get()
    filepath = os.path.join(cfg.audio_export_dir, meeting_id, "meeting_notes.md")
    return filepath if os.path.exists(filepath) else None
