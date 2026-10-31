import sqlite3
import os
import json
import uuid
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

DB_PATH = os.environ.get("QUORUM_DB_PATH") or os.path.join(os.path.dirname(__file__), "quorum.db")

def get_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cur = conn.cursor()

    # Meetings Table
    cur.execute("""
    CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        agenda TEXT,
        attendees TEXT,
        raw_notes TEXT DEFAULT '',
        enhanced_notes TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        ended_at TEXT,
        status TEXT DEFAULT 'active',
        duration_sec INTEGER DEFAULT 0,
        drift_score REAL DEFAULT 0.0
    )
    """)

    # Safe column additions if migrating existing DB
    try:
        cur.execute("ALTER TABLE meetings ADD COLUMN raw_notes TEXT DEFAULT ''")
    except Exception:
        pass
    try:
        cur.execute("ALTER TABLE meetings ADD COLUMN enhanced_notes TEXT DEFAULT ''")
    except Exception:
        pass
    for column in ("platform TEXT DEFAULT ''", "meeting_url TEXT DEFAULT ''", "processing_error TEXT DEFAULT ''"):
        try:
            cur.execute(f"ALTER TABLE meetings ADD COLUMN {column}")
        except Exception:
            pass

    # Transcript Segments Table
    cur.execute("""
    CREATE TABLE IF NOT EXISTS transcript_segments (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL,
        speaker_label TEXT NOT NULL,
        speaker_name TEXT NOT NULL,
        is_user INTEGER DEFAULT 0,
        text TEXT NOT NULL,
        start_time REAL NOT NULL,
        end_time REAL NOT NULL,
        timestamp_badge TEXT NOT NULL,
        raw_confidence REAL DEFAULT 0.95,
        created_at TEXT NOT NULL,
        FOREIGN KEY (meeting_id) REFERENCES meetings (id) ON DELETE CASCADE
    )
    """)

    # FTS5 Virtual Table for Instant Search
    cur.execute("""
    CREATE VIRTUAL TABLE IF NOT EXISTS transcript_fts USING fts5(
        segment_id UNINDEXED,
        meeting_id UNINDEXED,
        speaker_name,
        text,
        timestamp_badge UNINDEXED
    )
    """)

    # Epoch Summaries (Hierarchical Sliding Window Compaction)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS epoch_summaries (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL,
        epoch_index INTEGER NOT NULL,
        start_min INTEGER NOT NULL,
        end_min INTEGER NOT NULL,
        summary_markdown TEXT NOT NULL,
        key_topics TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (meeting_id) REFERENCES meetings (id) ON DELETE CASCADE
    )
    """)

    # Post-Meeting Synthesizer Output
    cur.execute("""
    CREATE TABLE IF NOT EXISTS meeting_analysis (
        id TEXT PRIMARY KEY,
        meeting_id TEXT UNIQUE NOT NULL,
        executive_summary TEXT NOT NULL,
        decisions_json TEXT,
        rejected_alternatives_json TEXT,
        action_plan_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (meeting_id) REFERENCES meetings (id) ON DELETE CASCADE
    )
    """)

    # Prioritized To-Dos
    cur.execute("""
    CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL,
        task TEXT NOT NULL,
        owner TEXT NOT NULL,
        deadline TEXT,
        priority TEXT DEFAULT 'MEDIUM',
        timestamp_ref TEXT,
        completed INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (meeting_id) REFERENCES meetings (id) ON DELETE CASCADE
    )
    """)
    for column in ("pinned INTEGER DEFAULT 0", "pinned_at TEXT"):
        try:
            cur.execute(f"ALTER TABLE todos ADD COLUMN {column}")
        except Exception:
            pass

    # Things to Remember (Sticky Memory Cards)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS things_to_remember (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL,
        fact TEXT NOT NULL,
        context TEXT,
        person TEXT,
        timestamp_ref TEXT,
        category TEXT DEFAULT 'Key Detail',
        created_at TEXT NOT NULL,
        FOREIGN KEY (meeting_id) REFERENCES meetings (id) ON DELETE CASCADE
    )
    """)

    # Personal Behavioral & Response Coaching
    cur.execute("""
    CREATE TABLE IF NOT EXISTS behavioral_coaching (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL,
        timestamp_ref TEXT NOT NULL,
        what_you_said TEXT NOT NULL,
        tone_detected TEXT NOT NULL,
        impact_analysis TEXT NOT NULL,
        better_response TEXT NOT NULL,
        coaching_principle TEXT NOT NULL,
        clarity_score INTEGER DEFAULT 75,
        empathy_score INTEGER DEFAULT 70,
        created_at TEXT NOT NULL,
        FOREIGN KEY (meeting_id) REFERENCES meetings (id) ON DELETE CASCADE
    )
    """)

    # 1-on-1 Individual Dossier Profiles
    cur.execute("""
    CREATE TABLE IF NOT EXISTS individuals (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        role TEXT,
        email TEXT,
        avatar_url TEXT,
        first_met TEXT,
        last_met TEXT,
        total_meetings INTEGER DEFAULT 1,
        talk_time_sec_total INTEGER DEFAULT 0,
        reliability_score INTEGER DEFAULT 85,
        communication_cheat_sheet TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """)

    # Individual Cross-Meeting Interactions
    cur.execute("""
    CREATE TABLE IF NOT EXISTS individual_interactions (
        id TEXT PRIMARY KEY,
        individual_id TEXT NOT NULL,
        meeting_id TEXT NOT NULL,
        timestamp_ref TEXT,
        quote TEXT NOT NULL,
        promises_by_them TEXT,
        promises_by_user TEXT,
        topic TEXT,
        sentiment TEXT DEFAULT 'neutral',
        created_at TEXT NOT NULL,
        FOREIGN KEY (individual_id) REFERENCES individuals (id) ON DELETE CASCADE,
        FOREIGN KEY (meeting_id) REFERENCES meetings (id) ON DELETE CASCADE
    )
    """)

    conn.commit()
    conn.close()
    print("[Database] Initialized empty schema successfully.")

def clear_all_data():
    import shutil
    from config_store import config_store
    conn = get_db()
    cur = conn.cursor()
    meeting_ids = [r["id"] for r in cur.execute("SELECT id FROM meetings").fetchall()]
    cur.execute("DELETE FROM transcript_fts")
    cur.execute("DELETE FROM individual_interactions")
    cur.execute("DELETE FROM individuals")
    cur.execute("DELETE FROM behavioral_coaching")
    cur.execute("DELETE FROM things_to_remember")
    cur.execute("DELETE FROM todos")
    cur.execute("DELETE FROM meeting_analysis")
    cur.execute("DELETE FROM epoch_summaries")
    cur.execute("DELETE FROM transcript_segments")
    cur.execute("DELETE FROM meetings")
    conn.commit()
    conn.close()

    # Delete all session files in storage
    try:
        export_dir = config_store.get().audio_export_dir
        for mid in meeting_ids:
            mdir = os.path.join(export_dir, mid)
            if os.path.isdir(mdir):
                shutil.rmtree(mdir, ignore_errors=True)
            wav_file = os.path.join(export_dir, f"{mid}.wav")
            if os.path.exists(wav_file):
                os.remove(wav_file)
        if os.path.isdir(export_dir):
            for entry in os.listdir(export_dir):
                full_p = os.path.join(export_dir, entry)
                if entry.startswith("meet-") or entry.startswith("demo-") or entry.endswith(".wav") or entry.endswith(".md"):
                    if os.path.isdir(full_p):
                        shutil.rmtree(full_p, ignore_errors=True)
                    else:
                        os.remove(full_p)
    except Exception as e:
        print(f"[Database] Storage cleanup notice: {e}")

    print("[Database] All data and storage files cleared.")

def seed_initial_data():
    conn = get_db()
    cur = conn.cursor()

    # Check if sample meeting exists
    cur.execute("SELECT id FROM meetings WHERE id = 'demo-meeting-01'")
    if cur.fetchone():
        conn.close()
        return

    now_iso = datetime.now(timezone.utc).isoformat()
    meeting_id = "demo-meeting-01"

    # 1. Seed Sample Meeting
    cur.execute("""
    INSERT INTO meetings (id, title, agenda, attendees, created_at, ended_at, status, duration_sec, drift_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        meeting_id,
        "Q4 Product Architecture & Launch Sync",
        "Finalize backend migration to microservices, define Q4 API SLA targets (<100ms p99), allocate engineering resources for launch, and sign off on cloud budget.",
        json.dumps(["Robin (ME)", "Sarah Chen (VP Eng)", "Marcus Vance (Principal PM)", "Priya Sharma (Staff Architect)"]),
        "2026-10-30T10:00:00Z",
        "2026-10-30T10:45:00Z",
        "completed",
        2700,
        18.5
    ))

    # 2. Seed Transcript Segments
    sample_segments = [
        ("ME", "Robin", 1, "Good morning everyone. Let's align on our Q4 architecture goals. We need to finalize the microservices migration and lock down our p99 latency target under 100 milliseconds.", 5.0, 15.0, "00:00:05"),
        ("Speaker_A", "Sarah Chen", 0, "Thanks Robin. From an executive perspective, our board cares deeply about reliability during peak Black Friday traffic. If we miss the 100 millisecond mark, customer conversion drops 4%.", 16.0, 28.0, "00:00:16"),
        ("Speaker_B", "Marcus Vance", 0, "From the product side, we have three major enterprise customers asking for real-time analytics streaming before they renew their contracts next month.", 29.0, 41.0, "00:00:29"),
        ("Speaker_C", "Priya Sharma", 0, "I've benchmarked the new gRPC transport layer. With connection pooling, we're seeing 64 milliseconds p99 in staging, which easily beats the SLA.", 42.0, 56.0, "00:00:42"),
        ("ME", "Robin", 1, "I think we can probably rebuild the entire data ingestion pipeline by Friday if nobody interrupts us.", 58.0, 69.0, "00:00:58"),
        ("Speaker_A", "Sarah Chen", 0, "That sounds very ambitious Robin, but what happens if the database migration hits a lock bottleneck like it did last sprint?", 71.0, 83.0, "00:01:11"),
        ("ME", "Robin", 1, "Well, we discussed this three weeks ago and everyone agreed on Postgres partitioning, so I don't know why we're rehashing it.", 85.0, 96.0, "00:01:25"),
        ("Speaker_B", "Marcus Vance", 0, "Speaking of facilities, did anyone see the email about the downtown office lease renewal and parking fee changes?", 98.0, 110.0, "00:01:38"),
        ("Speaker_C", "Priya Sharma", 0, "Marcus, that's not on our agenda today. Let's stay focused on the cloud budget and latency SLA.", 112.0, 122.0, "00:01:52"),
        ("Speaker_A", "Sarah Chen", 0, "Good catch Priya. Robin, what is the exact cost delta between provisioning reserved Kubernetes nodes versus AWS Fargate for our ingestion cluster?", 124.0, 139.0, "00:02:04"),
        ("ME", "Robin", 1, "Reserved nodes save us roughly 42% annualized, which amounts to twelve thousand dollars a month. I've prepared the Terraform manifest.", 141.0, 154.0, "00:02:21"),
        ("Speaker_B", "Marcus Vance", 0, "I commit to locking down the enterprise telemetry schema by Wednesday 3 PM so Robin's team has clean contract specs.", 156.0, 169.0, "00:02:36"),
        ("Speaker_C", "Priya Sharma", 0, "And I will configure the Prometheus alert rules for p99 latency spikes above 90 milliseconds with automated Slack paging.", 171.0, 184.0, "00:02:51"),
        ("ME", "Robin", 1, "Yeah, whatever Sarah thinks is fine, we'll make it work.", 186.0, 194.0, "00:03:06"),
        ("Speaker_A", "Sarah Chen", 0, "Let's be explicit: Robin owns Terraform provisioning, Marcus delivers telemetry schemas Wednesday, and Priya sets up alerts by Thursday EOD.", 196.0, 212.0, "00:03:16"),
        ("ME", "Robin", 1, "Agreed. I will review the Terraform manifest with Priya tomorrow morning at 10 AM and commit the pull request.", 214.0, 226.0, "00:03:34"),
        ("Speaker_A", "Sarah Chen", 0, "Excellent. Budget is approved for reserved instances. Meeting adjourned.", 228.0, 236.0, "00:03:48")
    ]

    for label, name, is_user, text, start, end, badge in sample_segments:
        seg_id = f"seg-{uuid.uuid4().hex[:8]}"
        cur.execute("""
        INSERT INTO transcript_segments (id, meeting_id, speaker_label, speaker_name, is_user, text, start_time, end_time, timestamp_badge, raw_confidence, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0.98, ?)
        """, (seg_id, meeting_id, label, name, is_user, text, start, end, badge, now_iso))

        # Index in FTS5
        cur.execute("""
        INSERT INTO transcript_fts (segment_id, meeting_id, speaker_name, text, timestamp_badge)
        VALUES (?, ?, ?, ?, ?)
        """, (seg_id, meeting_id, name, text, badge))

    # 3. Seed Epoch Summaries (Compacted sliding windows)
    cur.execute("""
    INSERT INTO epoch_summaries (id, meeting_id, epoch_index, start_min, end_min, summary_markdown, key_topics, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        f"epoch-{uuid.uuid4().hex[:8]}",
        meeting_id,
        1,
        0,
        10,
        "### Epoch 1: SLA Alignment & Architecture Strategy\n- Robin and Sarah aligned on sub-100ms p99 latency SLA critical for Q4 enterprise conversions.\n- Priya presented gRPC benchmark results (64ms p99 in staging).\n- Robin proposed rebuilding ingestion pipeline by Friday, but was cautioned by Sarah on database lock risks.",
        json.dumps(["Q4 Architecture", "SLA p99 Latency", "gRPC Benchmarks", "Database Partitioning"]),
        now_iso
    ))

    cur.execute("""
    INSERT INTO epoch_summaries (id, meeting_id, epoch_index, start_min, end_min, summary_markdown, key_topics, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        f"epoch-{uuid.uuid4().hex[:8]}",
        meeting_id,
        2,
        10,
        20,
        "### Epoch 2: Budget Decisions & Resource Allocation\n- Brief agenda drift by Marcus regarding office lease renewal was redirected back to cloud budget by Priya.\n- Robin confirmed 42% cost savings ($12k/mo) using reserved Kubernetes nodes over AWS Fargate.\n- Formal commitments locked: Marcus (schemas by Wed 3 PM), Priya (alerts by Thu EOD), Robin (Terraform PR review Wed 10 AM).",
        json.dumps(["Cloud Cost Optimization", "AWS Reserved Nodes", "Enterprise Schemas", "Action Commitments"]),
        now_iso
    ))

    # 4. Seed Meeting Analysis
    cur.execute("""
    INSERT INTO meeting_analysis (id, meeting_id, executive_summary, decisions_json, rejected_alternatives_json, action_plan_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        f"analysis-{uuid.uuid4().hex[:8]}",
        meeting_id,
        "The team achieved formal sign-off for the Q4 microservices architecture transition. Key latency SLA of <100ms p99 was verified feasible via Priya's gRPC benchmarks (64ms). Sarah approved switching from AWS Fargate to Reserved Kubernetes nodes, securing $144,000 in annualized infrastructure savings. Execution is de-risked by staging schema contracts before code cutovers.",
        json.dumps([
            "Adopt gRPC connection pooling for internal inter-service calls.",
            "Provision 1-year reserved Kubernetes nodes instead of serverless Fargate ($12k/mo savings).",
            "Enforce strict 90ms warning alerts in Prometheus with Slack auto-paging."
        ]),
        json.dumps([
            "AWS Fargate Serverless: Rejected due to 42% higher cost at current ingest volumes.",
            "Full Ingestion Pipeline Rewrite by Friday: Rejected as excessively high risk during active sprint.",
            "GraphQL gateway for internal services: Rejected in favor of lower latency gRPC."
        ]),
        json.dumps([
            {"phase": "Phase 1: Contracts (Days 1-2)", "details": "Marcus delivers finalized telemetry schema specs by Wednesday 3 PM."},
            {"phase": "Phase 2: Infrastructure (Days 2-3)", "details": "Robin and Priya deploy Terraform reserved nodes manifest and verify routing."},
            {"phase": "Phase 3: Telemetry & Verification (Days 3-4)", "details": "Priya provisions Prometheus alert rules and runs synthetic load test."}
        ]),
        now_iso
    ))

    # 5. Seed To-Dos
    cur.execute("""
    INSERT INTO todos (id, meeting_id, task, owner, deadline, priority, timestamp_ref, completed, created_at)
    VALUES
    (?, ?, 'Deliver locked telemetry schema specifications to engineering', 'Marcus Vance', 'Wednesday, Nov 4 - 3:00 PM', 'HIGH', '00:02:36', 0, ?),
    (?, ?, 'Review Terraform reserved nodes manifest with Priya & commit PR', 'Robin (ME)', 'Wednesday, Nov 4 - 10:00 AM', 'HIGH', '00:03:34', 0, ?),
    (?, ?, 'Configure Prometheus alert rules (90ms threshold) and Slack bot', 'Priya Sharma', 'Thursday, Nov 5 - 5:00 PM', 'MEDIUM', '00:02:51', 0, ?),
    (?, ?, 'Provide executive budget sign-off for reserved compute commitment', 'Sarah Chen', 'Friday, Nov 6 - 12:00 PM', 'LOW', '00:03:48', 1, ?)
    """, (
        f"todo-{uuid.uuid4().hex[:8]}", meeting_id, now_iso,
        f"todo-{uuid.uuid4().hex[:8]}", meeting_id, now_iso,
        f"todo-{uuid.uuid4().hex[:8]}", meeting_id, now_iso,
        f"todo-{uuid.uuid4().hex[:8]}", meeting_id, now_iso
    ))

    # 6. Seed Things to Remember
    cur.execute("""
    INSERT INTO things_to_remember (id, meeting_id, fact, context, person, timestamp_ref, category, created_at)
    VALUES
    (?, ?, 'Reserved nodes yield exactly 42% annualized savings ($12,000/month)', 'Cloud architecture budget evaluation vs AWS Fargate', 'Robin', '00:02:21', 'Financial Metric', ?),
    (?, ?, 'Sarah stressed board cares about Black Friday conversion loss: 4% drop per 100ms latency', 'High priority business constraint for architecture', 'Sarah Chen', '00:00:16', 'Executive Priority', ?),
    (?, ?, 'Priya benchmarked gRPC at 64ms p99 in staging environment', 'Proof of concept latency performance data', 'Priya Sharma', '00:00:42', 'Technical Fact', ?),
    (?, ?, 'Marcus has 3 enterprise clients whose renewals depend on real-time streaming telemetry', 'Sales contract renewal deadline next month', 'Marcus Vance', '00:00:29', 'Client Dependency', ?)
    """, (
        f"rem-{uuid.uuid4().hex[:8]}", meeting_id, now_iso,
        f"rem-{uuid.uuid4().hex[:8]}", meeting_id, now_iso,
        f"rem-{uuid.uuid4().hex[:8]}", meeting_id, now_iso,
        f"rem-{uuid.uuid4().hex[:8]}", meeting_id, now_iso
    ))

    # 7. Seed Personal Behavioral Coaching Cards for ME
    cur.execute("""
    INSERT INTO behavioral_coaching (id, meeting_id, timestamp_ref, what_you_said, tone_detected, impact_analysis, better_response, coaching_principle, clarity_score, empathy_score, created_at)
    VALUES
    (?, ?, '00:00:58', 'I think we can probably rebuild the entire data ingestion pipeline by Friday if nobody interrupts us.', 'Over-promising & Defensively Conditional', 'Created immediate skepticism from executive leadership and implied team colleagues are a nuisance. Sets up failure if unexpected bugs surface.', 'Rebuilding the full pipeline carries high regression risk for Friday''s demo. Let''s isolate the query optimizer first, which achieves 80% of the latency gain by Thursday, and schedule the schema refactor for Sprint 14.', 'Scope De-Risking & Phased Credibility: Never bet your entire reputation on an unbuffered timeline.', 62, 54, ?),
    (?, ?, '00:01:25', 'Well, we discussed this three weeks ago and everyone agreed on Postgres partitioning, so I don''t know why we''re rehashing it.', 'Rigid, Defensive & Combative', 'Dismisses valid context changes and shuts down collaborative inquiry. Makes you appear resistant to healthy technical scrutiny.', 'Marcus and Sarah make a valid point given the 5x surge in ingest volume we saw last week. Let''s review the current throughput numbers against our original assumptions so we''re aligned on whether partitioning still covers us.', 'Non-Defensive Inquiry & Data Reframing: Treat challenges to past decisions as opportunities to reaffirm data.', 58, 48, ?),
    (?, ?, '00:03:06', 'Yeah, whatever Sarah thinks is fine, we''ll make it work.', 'Passive Resignation & Abdicated Ownership', 'Signals disengagement and leaves deliverables ambiguous. When things break later, leadership remembers you conceded without professional dissent.', 'Sarah, to deliver on your target while protecting system reliability, we will need to deprioritize the real-time analytics export. If you''re comfortable with that tradeoff, we''ll sign off on the 100ms SLA.', 'Explicit Tradeoff Negotiation: True senior leadership means articulating costs and boundaries constructively.', 50, 60, ?)
    """, (
        f"coach-{uuid.uuid4().hex[:8]}", meeting_id, now_iso,
        f"coach-{uuid.uuid4().hex[:8]}", meeting_id, now_iso,
        f"coach-{uuid.uuid4().hex[:8]}", meeting_id, now_iso
    ))

    # 8. Seed Individuals & Longitudinal Profiles
    people = [
        ("Sarah Chen", "VP of Engineering", "sarah.chen@company.internal", "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150", 4, 1840, 94,
         "Values crisp executive summaries, data-backed ROI, and explicit downside risk mitigation. Dislikes vague optimistic dates.",
         "Prefers written briefs 2 hours before architectural syncs. Highly receptive to phased rollouts with explicit rollback triggers."),
        ("Marcus Vance", "Principal Product Manager", "marcus.vance@company.internal", "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150", 6, 2450, 88,
         "Driven by customer renewal dates and enterprise contract commitments. Can occasionally bring tangent topics into technical reviews.",
         "Keep conversations anchored on user telemetry and delivery milestones. Acknowledge customer urgency before steering to technical feasibility."),
        ("Priya Sharma", "Staff Infrastructure Engineer", "priya.sharma@company.internal", "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150", 5, 1920, 96,
         "Extremely rigorous on system metrics (p99 latency, memory leaks, connection pool exhaustion). Clear, objective, and collaborative.",
         "Bring code snippets, latency benchmarks, and architectural block diagrams. Highly effective partner for infrastructure reviews.")
    ]

    for name, role, email, avatar, total_m, talk_t, rel, cheat, notes in people:
        person_id = f"ind-{uuid.uuid4().hex[:8]}"
        cur.execute("""
        INSERT INTO individuals (id, name, role, email, avatar_url, first_met, last_met, total_meetings, talk_time_sec_total, reliability_score, communication_cheat_sheet, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            person_id, name, role, email, avatar, "2026-08-15T09:00:00Z", now_iso, total_m, talk_t, rel, cheat, notes, now_iso, now_iso
        ))

        # Add interactions
        cur.execute("""
        INSERT INTO individual_interactions (id, individual_id, meeting_id, timestamp_ref, quote, promises_by_them, promises_by_user, topic, sentiment, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            f"act-{uuid.uuid4().hex[:8]}", person_id, meeting_id, "00:00:16",
            "From an executive perspective, our board cares deeply about reliability during peak Black Friday traffic.",
            "Approved reserved node budget allocation ($144k annualized).",
            "Robin promised to deliver verified latency benchmarks with safety buffers.",
            "Q4 SLA & Executive Expectations", "positive", now_iso
        ))

    conn.commit()
    conn.close()
    print("[Database] Initialized and seeded successfully.")
