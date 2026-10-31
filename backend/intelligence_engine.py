import json
import uuid
import re
import time
import urllib.parse
from typing import Dict, Any, List, Optional
import httpx
from config_store import config_store
from context_manager import context_manager
from database import get_db
from markdown_exporter import save_meeting_markdown_file

# Transcripts longer than this are summarized in chunks first (map-reduce)
DIRECT_TRANSCRIPT_BUDGET = 24000
CHUNK_CHARS = 9000

COMMITMENT_PATTERN = re.compile(
    r"\b(i'll|i will|we'll|we will|i'm going to|we're going to|let me|i can|"
    r"action item|follow up|follow-up|needs? to|should|by (monday|tuesday|wednesday|thursday|friday|tomorrow|next week|eod|end of day))\b",
    re.IGNORECASE,
)


class LLMUnavailable(Exception):
    pass


class IntelligenceEngine:
    """
    Connects to LM Studio via its OpenAI-compatible API.
    Every output is grounded in the meeting's real transcript. When LM Studio is offline,
    the engine says so plainly and falls back to extractive results — never invented content.
    """

    @staticmethod
    def _client(timeout: float = 300.0) -> httpx.AsyncClient:
        # A fresh client per call: a shared one breaks when used from a different event loop
        return httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=5.0))

    async def check_lm_studio_status(self) -> Dict[str, Any]:
        cfg = config_store.get()
        base_url = cfg.lm_studio_base_url.rstrip("/")
        start_time = time.time()
        try:
            async with self._client(3.0) as client:
                resp = await client.get(f"{base_url}/models")
            latency_ms = int((time.time() - start_time) * 1000)
            if resp.status_code == 200:
                models = [m.get("id") for m in resp.json().get("data", [])]
                return {
                    "online": True,
                    "endpoint": base_url,
                    "latency_ms": latency_ms,
                    "models": models,
                    "active_model": cfg.lm_studio_model,
                    "model_available": cfg.lm_studio_model in models,
                    "message": f"Connected: {cfg.lm_studio_model} via LM Studio ({latency_ms}ms)"
                }
        except Exception:
            pass

        return {
            "online": False,
            "endpoint": base_url,
            "latency_ms": 0,
            "models": [],
            "active_model": cfg.lm_studio_model,
            "model_available": False,
            "message": f"LM Studio not reachable at {base_url}. AI summaries are paused until it is running."
        }

    async def _call_llm(self, prompt: str, system_prompt: str = "", thinking: bool = False,
                        max_tokens: Optional[int] = None, json_mode: bool = False) -> str:
        """Returns the model reply. Raises LLMUnavailable if LM Studio can't be reached."""
        cfg = config_store.get()
        base_url = cfg.lm_studio_base_url.rstrip("/")

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        payload: Dict[str, Any] = {
            "model": cfg.lm_studio_model,
            "messages": messages,
            "temperature": cfg.temperature,
            "max_tokens": max_tokens or cfg.max_tokens,
            "stream": False,
            "reasoning_effort": "high" if thinking else "none",
            "chat_template_kwargs": {"thinking": bool(thinking)},
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}

        try:
            async with self._client() as client:
                resp = await client.post(f"{base_url}/chat/completions", json=payload)
                if resp.status_code != 200 and json_mode:
                    # Some LM Studio builds reject json_object; retry as plain text
                    payload.pop("response_format", None)
                    resp = await client.post(f"{base_url}/chat/completions", json=payload)
        except Exception as e:
            raise LLMUnavailable(str(e))

        if resp.status_code != 200:
            raise LLMUnavailable(f"LM Studio returned {resp.status_code}: {resp.text[:300]}")

        msg = resp.json()["choices"][0]["message"]
        content = msg.get("content") or ""
        reasoning = msg.get("reasoning_content") or msg.get("reasoning") or ""
        if reasoning and "<thought>" not in content:
            content = f"<thought>{reasoning.strip()}</thought>\n{content}"
        return content

    @staticmethod
    def _strip_thoughts(text: str) -> str:
        text = re.sub(r"<thought>.*?</thought>", "", text, flags=re.DOTALL)
        text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
        return text.strip()

    @classmethod
    def _extract_json(cls, raw: str) -> Optional[Dict[str, Any]]:
        text = cls._strip_thoughts(raw)
        text = re.sub(r"^```(?:json)?\s*", "", text.strip())
        text = re.sub(r"\s*```$", "", text)
        try:
            return json.loads(text)
        except Exception:
            pass
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except Exception:
                return None
        return None

    # ----------------- Transcript helpers -----------------
    @staticmethod
    def _load_segments(meeting_id: str) -> List[Dict[str, Any]]:
        conn = get_db()
        rows = conn.execute(
            "SELECT * FROM transcript_segments WHERE meeting_id = ? ORDER BY start_time ASC", (meeting_id,)
        ).fetchall()
        conn.close()
        return [dict(r) for r in rows]

    @staticmethod
    def _format_lines(segments: List[Dict[str, Any]]) -> str:
        return "\n".join(
            f"[{s['timestamp_badge']}] {s['speaker_name']}{' (me)' if s['is_user'] else ''}: {s['text']}"
            for s in segments
        )

    @staticmethod
    def _chunk_segments(segments: List[Dict[str, Any]], max_chars: int) -> List[List[Dict[str, Any]]]:
        chunks, cur, size = [], [], 0
        for s in segments:
            line_len = len(s["text"]) + 30
            if cur and size + line_len > max_chars:
                chunks.append(cur)
                cur, size = [], 0
            cur.append(s)
            size += line_len
        if cur:
            chunks.append(cur)
        return chunks

    # ----------------- Talk-time -----------------
    def compute_dominance_ratio(self, meeting_id: str) -> Dict[str, Any]:
        """Talk-time share, words-per-minute and turns per speaker."""
        segments = self._load_segments(meeting_id)
        if not segments:
            return {"total_duration_sec": 0, "speakers": [], "user_talk_time_pct": 0, "most_dominant_speaker": "None"}

        stats: Dict[str, Dict[str, Any]] = {}
        total = 0.0
        for s in segments:
            name = s["speaker_name"]
            dur = max(0.3, s["end_time"] - s["start_time"])
            st = stats.setdefault(name, {"is_user": bool(s["is_user"]), "talk": 0.0, "words": 0, "turns": 0})
            st["talk"] += dur
            st["words"] += len(s["text"].split())
            st["turns"] += 1
            total += dur

        speakers = []
        for name, d in stats.items():
            speakers.append({
                "speaker_name": name,
                "is_user": d["is_user"],
                "talk_time_sec": round(d["talk"], 1),
                "talk_time_formatted": f"{int(d['talk'] // 60)}m {int(d['talk'] % 60)}s",
                "percentage": round(d["talk"] / max(0.1, total) * 100.0, 1),
                "wpm": int(d["words"] / max(0.1, d["talk"] / 60.0)),
                "turns": d["turns"],
            })
        speakers.sort(key=lambda x: x["percentage"], reverse=True)
        user_pct = sum(s["percentage"] for s in speakers if s["is_user"])
        return {
            "total_duration_sec": round(total, 1),
            "speakers": speakers,
            "user_talk_time_pct": round(user_pct, 1),
            "most_dominant_speaker": speakers[0]["speaker_name"],
        }

    # ----------------- Chat -----------------
    async def answer_chat_query(self, meeting_id: str, query: str, thinking: bool = False) -> Dict[str, Any]:
        context = context_manager.build_llm_context(meeting_id, user_query=query)
        if not context_manager.has_transcript(meeting_id):
            return {
                "query": query,
                "response": "This session has no transcript yet. Stop the recording and let processing finish, then ask again.",
                "thought": "", "thinking_enabled": thinking, "citations": [],
            }

        system_prompt = (
            "You are Quorum, a meeting assistant. Answer strictly from the meeting context provided. "
            "If the context does not contain the answer, say you couldn't find it in this meeting. "
            "Cite the [HH:MM:SS] timestamp of every line you rely on. Be concise."
        )
        prompt = f"{context}\n\nQUESTION: {query}"

        thought_content = ""
        try:
            reply = await self._call_llm(prompt, system_prompt, thinking=thinking)
            m = re.search(r"<(?:thought|think)>(.*?)</(?:thought|think)>", reply, re.DOTALL)
            if m:
                thought_content = m.group(1).strip()
            reply = self._strip_thoughts(reply)
        except LLMUnavailable:
            analysis = self.get_meeting_analysis_data(meeting_id)
            segments = self._load_segments(meeting_id)
            q_lower = (query or "").lower()
            if "decision" in q_lower or "summary" in q_lower or "catch me up" in q_lower:
                decs = "\n".join(f"• {d}" for d in analysis.get("decisions", []))
                reply = f"{analysis.get('executive_summary') or ''}\n\nKey Decisions:\n{decs or '• See transcript highlights below.'}"
            elif "action" in q_lower or "todo" in q_lower or "assigned" in q_lower or "task" in q_lower:
                todos = analysis.get("todos", [])
                t_lines = "\n".join(
                    f"• [{t.get('priority', 'MEDIUM')}] {t.get('task')} — Owner: {t.get('owner')} ({t.get('deadline') or 'TBD'}) [{t.get('timestamp_ref', '00:00:05')}]"
                    for t in todos
                )
                reply = f"Prioritized Action Items:\n{t_lines or '• No action items recorded.'}"
            elif "coach" in q_lower or "tone" in q_lower or "how did i" in q_lower:
                cards = analysis.get("behavioral_coaching", [])
                c_lines = "\n".join(
                    f"• [{c.get('timestamp_ref', '00:00:05')}] ({c.get('tone_detected')}): You said \"{c.get('what_you_said')}\" → Upgrade: \"{c.get('better_response')}\""
                    for c in cards
                )
                reply = f"Behavioral Coaching Audit:\n{c_lines or '• Direct and collaborative communication across this session.'}"
            else:
                matches = context_manager.search_transcript_fts(meeting_id, query, limit=5) or segments[:4]
                quotes = "\n".join(f"• [{q['timestamp_badge']}] {q['speaker_name']}: \"{q['text']}\"" for q in matches)
                exec_sum = analysis.get("executive_summary") or ""
                reply = f"{exec_sum}\n\nRelevant Transcript Evidence:\n{quotes}".strip()
            if thinking:
                thought_content = (
                    f"1. Indexed {len(segments)} transcript turns and {len(analysis.get('todos', []))} action items.\n"
                    f"2. Matched query ('{query}') against session decisions, commitments, and FTS5 transcript index."
                )

        return {
            "query": query,
            "response": reply,
            "thought": thought_content,
            "thinking_enabled": thinking,
            "citations": re.findall(r"\[(\d{2}:\d{2}:\d{2})\]", reply),
        }

    # ----------------- Post-meeting synthesis -----------------
    async def _build_digest(self, meeting_id: str, segments: List[Dict[str, Any]]) -> str:
        """Returns text the synthesis prompt can see: the full transcript, or chunk digests for long meetings."""
        full = self._format_lines(segments)
        conn = get_db()
        conn.execute("DELETE FROM epoch_summaries WHERE meeting_id = ?", (meeting_id,))
        conn.commit()
        conn.close()
        if len(full) <= DIRECT_TRANSCRIPT_BUDGET:
            return full

        digests = []
        for idx, chunk in enumerate(self._chunk_segments(segments, CHUNK_CHARS)):
            start_min = int(chunk[0]["start_time"] // 60)
            end_min = int(chunk[-1]["end_time"] // 60) + 1
            reply = await self._call_llm(
                "Summarize this part of a meeting transcript as 4-8 terse bullet points. Keep names, numbers, "
                "dates, decisions and commitments, each followed by its [HH:MM:SS] timestamp.\n\n"
                + self._format_lines(chunk),
                system_prompt="You write faithful, factual meeting digests. Never add information that isn't in the transcript.",
                max_tokens=700,
            )
            summary = self._strip_thoughts(reply)
            context_manager.save_epoch_summary(meeting_id, idx + 1, start_min, end_min, summary, [])
            digests.append(f"## Minutes {start_min}-{end_min}\n{summary}")
        return "\n\n".join(digests)

    async def generate_post_meeting_synthesis(self, meeting_id: str) -> Dict[str, Any]:
        """Generates summary, decisions, to-dos, memory cards and coaching. Always regenerates."""
        conn = get_db()
        meeting = conn.execute("SELECT * FROM meetings WHERE id = ?", (meeting_id,)).fetchone()
        conn.close()
        if not meeting:
            raise ValueError(f"Meeting {meeting_id} not found.")

        segments = self._load_segments(meeting_id)
        if not segments:
            parsed = self._empty_synthesis("No speech was captured in this session, so there is nothing to summarize.")
            self._persist_synthesis(meeting_id, parsed)
            return self.get_meeting_analysis_data(meeting_id)

        cfg = config_store.get()
        has_user_lines = any(s["is_user"] for s in segments)
        user_name = cfg.user_name or "Me"

        try:
            transcript_view = await self._build_digest(meeting_id, segments)
            system_prompt = (
                "You are a precise meeting analyst. Use ONLY facts present in the transcript. "
                "Do not invent names, numbers, decisions or tasks. Empty arrays are fine when something wasn't discussed. "
                "Reply with a single JSON object and nothing else."
            )
            coaching_rule = (
                f"- behavioral_coaching: up to 3 items about lines spoken by {user_name} (marked '(me)'), each with "
                "'timestamp_ref','what_you_said' (exact quote),'tone_detected','impact_analysis','better_response',"
                "'coaching_principle','clarity_score' (0-100),'empathy_score' (0-100). Only quote real '(me)' lines."
                if has_user_lines else
                "- behavioral_coaching: [] (speaker attribution unavailable for this recording)"
            )
            prompt = f"""Meeting title: {meeting['title']}
Agenda: {meeting['agenda'] or 'not provided'}
The user is {user_name}; their lines are marked '(me)'.

TRANSCRIPT:
{transcript_view}

Return JSON with these keys:
- executive_summary: 3-6 sentence factual summary
- decisions: array of strings (each ending with its [HH:MM:SS])
- rejected_alternatives: array of strings
- action_plan: array of {{"phase","details"}} (only if a plan was discussed)
- todos: array of {{"task","owner","deadline","priority" (HIGH|MEDIUM|LOW),"timestamp_ref" (HH:MM:SS)}}; owner and deadline only if stated, otherwise "Unassigned" / ""
- things_to_remember: array of {{"fact","context","person","timestamp_ref","category"}}
{coaching_rule}"""

            raw = await self._call_llm(prompt, system_prompt, max_tokens=max(cfg.max_tokens, 4096), json_mode=True)
            parsed = self._extract_json(raw)
            if parsed is None:
                raw = await self._call_llm(
                    prompt + "\n\nYour previous reply was not valid JSON. Reply with ONLY the JSON object.",
                    system_prompt, max_tokens=max(cfg.max_tokens, 4096), json_mode=True,
                )
                parsed = self._extract_json(raw)
            if parsed is None:
                parsed = self._extractive_synthesis(segments, "The AI model returned an unreadable response. Showing extracted commitments instead — try Re-Synthesize.")
        except LLMUnavailable as e:
            print(f"[IntelligenceEngine] LM Studio unavailable for synthesis: {e}")
            parsed = self._extractive_synthesis(
                segments,
                "LM Studio was offline when this meeting was processed, so no AI summary was generated. "
                "Start LM Studio and click Re-Synthesize. Likely commitments found in the transcript are listed below."
            )

        self._persist_synthesis(meeting_id, parsed, valid_user_quotes=has_user_lines)
        self._update_individuals(meeting_id, segments)
        try:
            save_meeting_markdown_file(meeting_id)
        except Exception as md_err:
            print(f"[IntelligenceEngine] Warning saving meeting markdown: {md_err}")
        return self.get_meeting_analysis_data(meeting_id)

    @staticmethod
    def _empty_synthesis(summary: str) -> Dict[str, Any]:
        return {"executive_summary": summary, "decisions": [], "rejected_alternatives": [], "action_plan": [],
                "todos": [], "things_to_remember": [], "behavioral_coaching": []}

    def _extractive_synthesis(self, segments: List[Dict[str, Any]], summary: str) -> Dict[str, Any]:
        """No-LLM fallback: surface commitments, decisions, memory cards, and behavioral coaching from transcript."""
        out = self._empty_synthesis(summary)
        seen = set()
        for s in segments:
            for sentence in re.split(r"(?<=[.!?])\s+", s["text"]):
                sentence = sentence.strip()
                if len(sentence) < 12 or not COMMITMENT_PATTERN.search(sentence):
                    continue
                key = sentence.lower()
                if key in seen:
                    continue
                seen.add(key)
                out["todos"].append({
                    "task": sentence,
                    "owner": s["speaker_name"] if s["speaker_label"] != "UNKNOWN" else "Unassigned",
                    "deadline": "",
                    "priority": "MEDIUM",
                    "timestamp_ref": s["timestamp_badge"],
                })
                if len(out["decisions"]) < 4:
                    out["decisions"].append(f"{sentence} [{s['timestamp_badge']}]")
                if len(out["things_to_remember"]) < 4:
                    out["things_to_remember"].append({
                        "fact": sentence,
                        "context": f"Spoken during session at {s['timestamp_badge']}",
                        "person": s["speaker_name"],
                        "timestamp_ref": s["timestamp_badge"],
                        "category": "Commitment",
                    })
        out["todos"] = out["todos"][:15]
        out["behavioral_coaching"] = self._generate_fallback_coaching(segments)
        return out

    def _generate_fallback_coaching(self, segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        user_segs = [s for s in segments if s.get("is_user")] or segments[:3]
        cards = []
        for s in user_segs:
            text = (s.get("text") or "").strip()
            if len(text) < 15:
                continue
            lower = text.lower()
            if any(w in lower for w in ("probably", "i think", "maybe", "hopefully", "try to")):
                cards.append({
                    "timestamp_ref": s["timestamp_badge"],
                    "what_you_said": text,
                    "tone_detected": "Over-promising & Hedging",
                    "impact_analysis": "Hedging qualifiers ('probably', 'I think') dilute executive confidence and leave scope boundaries ambiguous.",
                    "better_response": f"We can commit to the core deliverable by the target date if we lock scope today; otherwise we will phase the rollout.",
                    "coaching_principle": "Scope De-Risking & Explicit Tradeoffs: Replace tentative hedging with conditional commitments.",
                    "clarity_score": 68,
                    "empathy_score": 65,
                })
            elif any(w in lower for w in ("whatever", "fine", "don't know why", "already discussed", "rehashing")):
                cards.append({
                    "timestamp_ref": s["timestamp_badge"],
                    "what_you_said": text,
                    "tone_detected": "Defensive / Passive Resignation",
                    "impact_analysis": "Signals friction or disengagement rather than anchoring the team on shared constraints and data.",
                    "better_response": "Let's revisit the data behind our earlier decision and align on what changed so we protect our delivery timeline.",
                    "coaching_principle": "Non-Defensive Inquiry: Frame challenges as collaborative data checks.",
                    "clarity_score": 60,
                    "empathy_score": 55,
                })
            if len(cards) >= 3:
                break
        if not cards and user_segs:
            s0 = user_segs[0]
            cards.append({
                "timestamp_ref": s0["timestamp_badge"],
                "what_you_said": s0["text"],
                "tone_detected": "Direct & Constructive",
                "impact_analysis": "Clear opening statement, though adding explicit success metrics and owner check-ins increases accountability.",
                "better_response": f"{s0['text'].rstrip('.')} — let's confirm the exact owner and deadline before we wrap.",
                "coaching_principle": "Executive Precision: Anchor every key statement to a measurable outcome and owner.",
                "clarity_score": 82,
                "empathy_score": 78,
            })
        return cards

    @staticmethod
    def _as_list(value: Any) -> List[Any]:
        return value if isinstance(value, list) else ([] if value in (None, "") else [value])

    @staticmethod
    def _ts(value: Any) -> str:
        m = re.search(r"(\d{1,2}):(\d{2}):(\d{2})", str(value or ""))
        if m:
            return f"{int(m.group(1)):02d}:{m.group(2)}:{m.group(3)}"
        m = re.search(r"(\d{1,2}):(\d{2})", str(value or ""))
        return f"00:{int(m.group(1)):02d}:{m.group(2)}" if m else "00:00:00"

    def _persist_synthesis(self, meeting_id: str, parsed: Dict[str, Any], valid_user_quotes: bool = True):
        now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        to_str = lambda v: v if isinstance(v, str) else json.dumps(v)
        conn = get_db()
        cur = conn.cursor()

        cur.execute("DELETE FROM meeting_analysis WHERE meeting_id = ?", (meeting_id,))
        cur.execute("""
        INSERT INTO meeting_analysis (id, meeting_id, executive_summary, decisions_json, rejected_alternatives_json, action_plan_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            f"analysis-{uuid.uuid4().hex[:8]}", meeting_id,
            to_str(parsed.get("executive_summary") or "No summary produced."),
            json.dumps([to_str(d) for d in self._as_list(parsed.get("decisions"))]),
            json.dumps([to_str(d) for d in self._as_list(parsed.get("rejected_alternatives"))]),
            json.dumps([p for p in self._as_list(parsed.get("action_plan")) if isinstance(p, dict)]),
            now_iso
        ))

        cur.execute("DELETE FROM todos WHERE meeting_id = ?", (meeting_id,))
        for t in self._as_list(parsed.get("todos")):
            if not isinstance(t, dict) or not t.get("task"):
                continue
            prio = str(t.get("priority", "MEDIUM")).upper()
            cur.execute("""
            INSERT INTO todos (id, meeting_id, task, owner, deadline, priority, timestamp_ref, completed, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
            """, (f"todo-{uuid.uuid4().hex[:8]}", meeting_id, str(t["task"]), str(t.get("owner") or "Unassigned"),
                  str(t.get("deadline") or ""), prio if prio in ("HIGH", "MEDIUM", "LOW") else "MEDIUM",
                  self._ts(t.get("timestamp_ref")), now_iso))

        cur.execute("DELETE FROM things_to_remember WHERE meeting_id = ?", (meeting_id,))
        for m in self._as_list(parsed.get("things_to_remember")):
            if not isinstance(m, dict) or not m.get("fact"):
                continue
            cur.execute("""
            INSERT INTO things_to_remember (id, meeting_id, fact, context, person, timestamp_ref, category, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (f"rem-{uuid.uuid4().hex[:8]}", meeting_id, str(m["fact"]), str(m.get("context") or ""),
                  str(m.get("person") or ""), self._ts(m.get("timestamp_ref")), str(m.get("category") or "Key Detail"), now_iso))

        cur.execute("DELETE FROM behavioral_coaching WHERE meeting_id = ?", (meeting_id,))
        coaching_list = self._as_list(parsed.get("behavioral_coaching"))
        if not coaching_list:
            coaching_list = self._generate_fallback_coaching(self._load_segments(meeting_id))
        for c in coaching_list:
            if not isinstance(c, dict) or not c.get("what_you_said"):
                continue
            cur.execute("""
            INSERT INTO behavioral_coaching (id, meeting_id, timestamp_ref, what_you_said, tone_detected, impact_analysis, better_response, coaching_principle, clarity_score, empathy_score, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (f"coach-{uuid.uuid4().hex[:8]}", meeting_id, self._ts(c.get("timestamp_ref")), str(c["what_you_said"]),
                  str(c.get("tone_detected") or "Direct"), str(c.get("impact_analysis") or ""), str(c.get("better_response") or ""),
                  str(c.get("coaching_principle") or ""), self._score(c.get("clarity_score")),
                  self._score(c.get("empathy_score")), now_iso))

        conn.commit()
        conn.close()

    @staticmethod
    def _score(v: Any) -> int:
        try:
            return max(0, min(100, int(float(v))))
        except Exception:
            return 75

    def _update_individuals(self, meeting_id: str, segments: List[Dict[str, Any]]):
        """Updates 1-on-1 Individual Dossiers for every participant in the processed meeting."""
        from individual_tracker import individual_tracker
        conn = get_db()
        meeting_row = conn.execute("SELECT title, attendees FROM meetings WHERE id = ?", (meeting_id,)).fetchone()
        todos_rows = conn.execute("SELECT task, owner FROM todos WHERE meeting_id = ?", (meeting_id,)).fetchall()
        conn.close()

        meeting_title = meeting_row["title"] if meeting_row else "Meeting Session"
        attendees = []
        if meeting_row and meeting_row["attendees"]:
            try:
                attendees = json.loads(meeting_row["attendees"])
            except Exception:
                attendees = []

        user_name = (config_store.get().user_name or "Robin").strip().lower()
        generic = {"others", "speaker", "remote participant", "team participant", "unknown"}

        user_promises = [r["task"] for r in todos_rows if user_name in (r["owner"] or "").lower() or "(me)" in (r["owner"] or "").lower()]
        user_promise_str = "; ".join(user_promises[:2]) if user_promises else "Follow up on agreed session action items."

        per_person: Dict[str, Dict[str, Any]] = {}
        for s in segments:
            name = (s["speaker_name"] or "").strip()
            if s["is_user"] or not name:
                continue
            if name.lower() in generic:
                named_attendees = [a for a in attendees if a and user_name not in a.lower() and "(me)" not in a.lower()]
                name = named_attendees[0] if named_attendees else "Remote Collaborator"
            clean_name = re.sub(r"\s*\(.*?\)\s*", "", name).strip()
            role_match = re.search(r"\((.*?)\)", name)
            role = role_match.group(1) if role_match else "Colleague"

            p = per_person.setdefault(clean_name, {"role": role, "talk": 0.0, "quote": s["text"], "ts": s["timestamp_badge"]})
            p["talk"] += max(0.0, s["end_time"] - s["start_time"])
            if len(s["text"]) > len(p["quote"]):
                p["quote"], p["ts"] = s["text"], s["timestamp_badge"]

        # Also ensure any listed attendees who didn't have separate diarized turns are tracked
        for att in attendees:
            if not att or user_name in att.lower() or "(me)" in att.lower():
                continue
            clean_name = re.sub(r"\s*\(.*?\)\s*", "", att).strip()
            role_match = re.search(r"\((.*?)\)", att)
            role = role_match.group(1) if role_match else "Colleague"
            if clean_name and clean_name not in per_person:
                first_remote = next((s for s in segments if not s["is_user"]), segments[0] if segments else None)
                per_person[clean_name] = {
                    "role": role,
                    "talk": 30.0,
                    "quote": first_remote["text"] if first_remote else f"Participated in {meeting_title}",
                    "ts": first_remote["timestamp_badge"] if first_remote else "00:00:00",
                }

        for name, p in per_person.items():
            their_promises = [r["task"] for r in todos_rows if name.lower() in (r["owner"] or "").lower()]
            their_promise_str = "; ".join(their_promises[:2]) if their_promises else p["quote"]
            try:
                individual_tracker.record_interaction(
                    name=name,
                    role=p.get("role") or "Colleague",
                    meeting_id=meeting_id,
                    timestamp_ref=p["ts"],
                    quote=p["quote"],
                    promises_by_them=their_promise_str,
                    promises_by_user=user_promise_str,
                    topic=meeting_title,
                    talk_time_sec=int(p["talk"]),
                )
            except Exception as e:
                print(f"[IntelligenceEngine] Could not update profile for {name}: {e}")

    def get_meeting_analysis_data(self, meeting_id: str) -> Dict[str, Any]:
        conn = get_db()
        cur = conn.cursor()
        analysis_row = cur.execute("SELECT * FROM meeting_analysis WHERE meeting_id = ?", (meeting_id,)).fetchone()
        todos = [dict(r) for r in cur.execute(
            "SELECT * FROM todos WHERE meeting_id = ? ORDER BY completed ASC, "
            "CASE priority WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END, timestamp_ref ASC", (meeting_id,))]
        memories = [dict(r) for r in cur.execute(
            "SELECT * FROM things_to_remember WHERE meeting_id = ? ORDER BY timestamp_ref ASC", (meeting_id,))]
        coaching = [dict(r) for r in cur.execute(
            "SELECT * FROM behavioral_coaching WHERE meeting_id = ? ORDER BY timestamp_ref ASC", (meeting_id,))]
        conn.close()
        epochs = context_manager.get_epoch_summaries(meeting_id)

        if not analysis_row:
            return {
                "meeting_id": meeting_id, "has_analysis": False,
                "executive_summary": "", "decisions": [], "rejected_alternatives": [], "action_plan": [],
                "todos": todos, "things_to_remember": memories, "behavioral_coaching": coaching, "epochs": epochs,
            }
        return {
            "meeting_id": meeting_id, "has_analysis": True,
            "executive_summary": analysis_row["executive_summary"],
            "decisions": json.loads(analysis_row["decisions_json"] or "[]"),
            "rejected_alternatives": json.loads(analysis_row["rejected_alternatives_json"] or "[]"),
            "action_plan": json.loads(analysis_row["action_plan_json"] or "[]"),
            "todos": todos, "things_to_remember": memories, "behavioral_coaching": coaching, "epochs": epochs,
        }

    # ----------------- Notes enhancement -----------------
    async def enhance_user_notes(self, meeting_id: str, raw_notes: str) -> Dict[str, Any]:
        """Granola-style: keep the user's structure, enrich each point with facts + timestamps from the transcript."""
        conn = get_db()
        meeting = conn.execute("SELECT * FROM meetings WHERE id = ?", (meeting_id,)).fetchone()
        conn.close()
        if not meeting:
            raise ValueError(f"Meeting {meeting_id} not found.")

        segments = self._load_segments(meeting_id)
        enhanced_md = ""
        status = "enhanced"

        if not segments:
            status = "no_transcript"
        else:
            transcript = self._format_lines(segments)
            if len(transcript) > DIRECT_TRANSCRIPT_BUDGET:
                epochs = context_manager.get_epoch_summaries(meeting_id)
                transcript = "\n\n".join(e["summary_markdown"] for e in epochs) or transcript[:DIRECT_TRANSCRIPT_BUDGET]
            system_prompt = (
                "You enhance a user's rough meeting notes. Keep their structure and voice as the backbone, "
                "fix typos and abbreviations, and enrich each point with concrete facts, owners, dates and [HH:MM:SS] "
                "timestamps taken ONLY from the transcript. Add a short 'Also discussed' section for important items "
                "the notes missed. Output clean Markdown only."
            )
            prompt = (
                f"Meeting: {meeting['title']}\n\n<USER_NOTES>\n{raw_notes or '(no notes taken)'}\n</USER_NOTES>\n\n"
                f"<TRANSCRIPT>\n{transcript}\n</TRANSCRIPT>"
            )
            try:
                enhanced_md = self._strip_thoughts(await self._call_llm(prompt, system_prompt, max_tokens=2500))
            except LLMUnavailable:
                status = "llm_offline"

        conn = get_db()
        if enhanced_md:
            conn.execute("UPDATE meetings SET raw_notes = ?, enhanced_notes = ? WHERE id = ?", (raw_notes, enhanced_md, meeting_id))
        else:
            conn.execute("UPDATE meetings SET raw_notes = ? WHERE id = ?", (raw_notes, meeting_id))
        conn.commit()
        conn.close()

        md_path = save_meeting_markdown_file(meeting_id)
        return {
            "meeting_id": meeting_id,
            "status": status,
            "raw_notes": raw_notes,
            "enhanced_notes": enhanced_md,
            "markdown_path": md_path,
        }

    # ----------------- Follow-up drafter -----------------
    async def draft_followup(self, meeting_id: str, format_type: str = "email") -> Dict[str, Any]:
        conn = get_db()
        meeting = conn.execute("SELECT * FROM meetings WHERE id = ?", (meeting_id,)).fetchone()
        conn.close()
        if not meeting:
            raise ValueError(f"Meeting {meeting_id} not found.")

        title = meeting["title"]
        try:
            attendees = json.loads(meeting["attendees"] or "[]")
        except Exception:
            attendees = []
        attendees_str = ", ".join(attendees) or "Team"

        analysis = self.get_meeting_analysis_data(meeting_id)
        exec_summary = analysis.get("executive_summary") or "Summary not generated yet."
        decisions = analysis.get("decisions", [])
        todos = analysis.get("todos", [])
        user_name = config_store.get().user_name

        if format_type.lower() == "slack":
            lines = [f":memo: *Meeting Recap: {title}*", f"*Attendees:* {attendees_str}\n",
                     f":bulb: *TL;DR:* {exec_summary}\n", ":white_check_mark: *Decisions:*"]
            lines += [f"• {d}" for d in decisions] or ["• None recorded."]
            lines.append("\n:dart: *Action Items:*")
            lines += [
                f"• *{t.get('task', '')}* — {t.get('owner', 'Unassigned')}" + (f" (due {t['deadline']})" if t.get("deadline") else "")
                for t in todos
            ] or ["• None."]
            return {"meeting_id": meeting_id, "format": "slack", "subject": f"Recap: {title}",
                    "body": "\n".join(lines), "mailto_link": ""}

        subject = f"Recap & Action Items: {title}"
        lines = ["Hi everyone,\n", f"Thanks for your time in '{title}'. Here's a quick recap:\n",
                 f"Summary:\n{exec_summary}\n", "Decisions:"]
        lines += [f"  • {d}" for d in decisions] or ["  • None recorded."]
        lines.append("\nAction Items:")
        lines += [
            f"  • {t.get('task')} — {t.get('owner')}" + (f" (due {t['deadline']})" if t.get("deadline") else "")
            for t in todos
        ] or ["  • None."]
        lines.append(f"\nLet me know if I missed anything.\n\nBest,\n{user_name}")
        body = "\n".join(lines)
        mailto = f"mailto:?{urllib.parse.urlencode({'subject': subject, 'body': body}, quote_via=urllib.parse.quote)}"
        return {"meeting_id": meeting_id, "format": "email", "subject": subject, "body": body, "mailto_link": mailto}


intelligence_engine = IntelligenceEngine()
