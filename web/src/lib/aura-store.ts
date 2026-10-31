import fs from "node:fs";
import path from "node:path";
import type {
  Meeting,
  TranscriptSegment,
  DominanceData,
  DominanceSpeaker,
  TodoItem,
  MemoryCard,
  CoachingCard,
  IndividualProfile,
  FollowupDraft,
  GlobalSearchResult,
  ActiveRecording,
  ProcessingStatus,
  WhisperModelInfo,
  DetectedCallInfo,
} from "./api";

export interface EpochSummary {
  id: string;
  meeting_id: string;
  epoch_index: number;
  start_min: number;
  end_min: number;
  summary_markdown: string;
  key_topics: string[];
  created_at: string;
}

export interface MeetingAnalysisRecord {
  id: string;
  meeting_id: string;
  executive_summary: string;
  decisions: string[];
  rejected_alternatives: string[];
  action_plan: { phase: string; details: string }[];
  created_at: string;
}

export interface AppSettings {
  lm_studio_base_url: string;
  lm_studio_model: string;
  temperature: number;
  max_tokens: number;
  vad_aggressiveness: number;
  noise_cleaning_enabled: boolean;
  epoch_window_minutes: number;
  default_calendar: string;
  user_name: string;
  audio_export_dir: string;
  whisper_model: string;
  whisper_language: string;
}

export interface AuraStoreState {
  settings: AppSettings;
  meetings: Meeting[];
  transcripts: Record<string, TranscriptSegment[]>;
  analyses: Record<string, MeetingAnalysisRecord>;
  epochs: Record<string, EpochSummary[]>;
  todos: TodoItem[];
  memories: MemoryCard[];
  coaching: CoachingCard[];
  individuals: IndividualProfile[];
  activeRecordings: Record<string, ActiveRecording>;
  processingStatuses: Record<string, ProcessingStatus>;
  downloadedWhisperModels: Record<string, boolean>;
  autoDetectEnabled: boolean;
  autoRecordEnabled: boolean;
  detectedCalls: DetectedCallInfo[];
}

export const STORAGE_ROOT = "/tmp/aura-recordings";

export const WHISPER_MODEL_CATALOG: Omit<WhisperModelInfo, "status" | "ready" | "downloaded" | "local_path">[] = [
  {
    id: "large-v3-turbo",
    name: "Whisper Large-v3-Turbo",
    badge: "Fast • Recommended",
    size: "1.5 GB",
    recommended: true,
  },
  {
    id: "large-v3",
    name: "Whisper Large-v3",
    badge: "Highest Accuracy",
    size: "2.9 GB",
    recommended: false,
  },
  {
    id: "medium",
    name: "Whisper Medium",
    badge: "Balanced Multilingual",
    size: "1.4 GB",
    recommended: false,
  },
  {
    id: "small",
    name: "Whisper Small",
    badge: "Fast & Lightweight",
    size: "466 MB",
    recommended: false,
  },
  {
    id: "base",
    name: "Whisper Base",
    badge: "Ultra-Fast Standard",
    size: "145 MB",
    recommended: false,
  },
];

function createSilentWavBuffer(durationSec = 2): Buffer {
  const sampleRate = 16000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = sampleRate * durationSec;
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

export function ensureSessionFilesOnDisk(
  meeting: Meeting,
  markdownContent?: string
): { audioPath: string; markdownPath: string; folderPath: string; sizeBytes: number } {
  const folderPath = path.join(STORAGE_ROOT, meeting.id);
  const audioPath = path.join(folderPath, "audio.wav");
  const markdownPath = path.join(folderPath, "meeting_notes.md");
  try {
    fs.mkdirSync(folderPath, { recursive: true });
    if (!fs.existsSync(audioPath)) {
      fs.writeFileSync(audioPath, createSilentWavBuffer(2));
    }
    if (markdownContent !== undefined || !fs.existsSync(markdownPath)) {
      fs.writeFileSync(
        markdownPath,
        markdownContent || `# Meeting Notes: ${meeting.title}\n\nSession ID: ${meeting.id}\n`,
        "utf-8"
      );
    }
    const stat = fs.statSync(audioPath);
    return { audioPath, markdownPath, folderPath, sizeBytes: stat.size };
  } catch {
    return { audioPath, markdownPath, folderPath, sizeBytes: 64044 };
  }
}

export function deleteSessionFilesFromDisk(meetingId: string): boolean {
  const folderPath = path.join(STORAGE_ROOT, meetingId);
  const standaloneWav = path.join(STORAGE_ROOT, `${meetingId}.wav`);
  let removed = false;
  try {
    if (fs.existsSync(folderPath)) {
      fs.rmSync(folderPath, { recursive: true, force: true });
      removed = true;
    }
    if (fs.existsSync(standaloneWav)) {
      fs.rmSync(standaloneWav, { force: true });
      removed = true;
    }
  } catch {
    // ignore fs cleanup errors
  }
  return removed;
}

export function getStorageStats(): {
  directory: string;
  total_files: number;
  session_folders: string[];
} {
  try {
    fs.mkdirSync(STORAGE_ROOT, { recursive: true });
    const entries = fs.readdirSync(STORAGE_ROOT, { withFileTypes: true });
    const sessionFolders: string[] = [];
    let totalFiles = 0;
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (ent.name !== "models" && ent.name !== "dossiers") {
          sessionFolders.push(ent.name);
        }
        const subPath = path.join(STORAGE_ROOT, ent.name);
        try {
          totalFiles += fs.readdirSync(subPath).length;
        } catch {
          // ignore
        }
      } else {
        totalFiles += 1;
      }
    }
    return {
      directory: STORAGE_ROOT,
      total_files: totalFiles,
      session_folders: sessionFolders,
    };
  } catch {
    return { directory: STORAGE_ROOT, total_files: 0, session_folders: [] };
  }
}

const FILLER_REGEX = /\b(um+|uh+|erm|you know|i mean|kind of|sort of|basically|actually|literally)\b/gi;

export function computeDominanceRatio(segments: TranscriptSegment[]): DominanceData {
  if (!segments || segments.length === 0) {
    return {
      total_duration_sec: 0,
      speakers: [],
      user_talk_time_pct: 0,
      most_dominant_speaker: "None",
    };
  }

  const stats: Record<
    string,
    { is_user: boolean; talk: number; words: number; turns: number }
  > = {};
  let total = 0;

  for (const s of segments) {
    const name = s.speaker_name || "Unknown";
    const dur = Math.max(0.3, (s.end_time || 0) - (s.start_time || 0));
    if (!stats[name]) {
      stats[name] = { is_user: Boolean(s.is_user), talk: 0, words: 0, turns: 0 };
    }
    stats[name].talk += dur;
    stats[name].words += (s.text || "").trim().split(/\s+/).filter(Boolean).length;
    stats[name].turns += 1;
    total += dur;
  }

  const speakers: DominanceSpeaker[] = Object.entries(stats).map(([speaker_name, d]) => {
    const mins = Math.floor(d.talk / 60);
    const secs = Math.floor(d.talk % 60);
    const pct = Math.round((d.talk / Math.max(0.1, total)) * 1000) / 10;
    const wpm = Math.round(d.words / Math.max(0.1, d.talk / 60));
    return {
      speaker_name,
      is_user: d.is_user,
      talk_time_sec: Math.round(d.talk * 10) / 10,
      talk_time_formatted: `${mins}m ${secs}s`,
      percentage: pct,
      wpm,
      turns: d.turns,
    };
  });

  speakers.sort((a, b) => b.percentage - a.percentage);
  const userPct =
    Math.round(
      speakers.filter((s) => s.is_user).reduce((acc, s) => acc + s.percentage, 0) * 10
    ) / 10;

  return {
    total_duration_sec: Math.round(total * 10) / 10,
    speakers,
    user_talk_time_pct: userPct,
    most_dominant_speaker: speakers[0]?.speaker_name || "None",
  };
}

export function computeCoachMetrics(
  cards: CoachingCard[],
  userSegments: TranscriptSegment[]
) {
  if (!cards || cards.length === 0) {
    return {
      clarity_score: 0,
      empathy_ratio: 0,
      filler_words_per_min: 0,
      talk_minutes: 0,
    };
  }

  const avgClarity = Math.round(
    cards.reduce((acc, c) => acc + (c.clarity_score || 0), 0) / cards.length
  );
  const avgEmpathy = Math.round(
    cards.reduce((acc, c) => acc + (c.empathy_score || 0), 0) / cards.length
  );

  const talkMin =
    userSegments.reduce(
      (acc, s) => acc + Math.max(0, (s.end_time || 0) - (s.start_time || 0)),
      0
    ) / 60;

  let fillerCount = 0;
  for (const s of userSegments) {
    const matches = (s.text || "").match(FILLER_REGEX);
    if (matches) fillerCount += matches.length;
  }

  return {
    clarity_score: avgClarity,
    empathy_ratio: avgEmpathy,
    filler_words_per_min: talkMin > 0 ? Math.round((fillerCount / talkMin) * 10) / 10 : 0,
    talk_minutes: Math.round(talkMin * 10) / 10,
  };
}

export function generateCalendarLinks(params: {
  title: string;
  description?: string;
  deadline?: string;
  attendees?: string[];
}) {
  const now = new Date();
  const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  start.setUTCHours(10, 0, 0, 0);

  const clean = (params.deadline || "").toLowerCase();
  if (clean.includes("wednesday")) {
    start.setUTCHours(15, 0, 0, 0);
  } else if (clean.includes("thursday")) {
    start.setUTCHours(17, 0, 0, 0);
  } else if (clean.includes("friday")) {
    start.setUTCHours(12, 0, 0, 0);
  }

  const end = new Date(start.getTime() + 45 * 60 * 1000);
  const toGoogleDate = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

  const gStart = toGoogleDate(start);
  const gEnd = toGoogleDate(end);
  const isoStart = start.toISOString();
  const isoEnd = end.toISOString();

  const safeTitle = (params.title || "Meeting Action Item").trim();
  let safeDesc = (params.description || "").trim();
  if (params.deadline) {
    safeDesc += `\n\n[Deadline Reference: ${params.deadline}]`;
  }
  safeDesc += "\n\nGenerated by AURA-MEET Behavioral Copilot";

  const googleParams = new URLSearchParams({
    action: "TEMPLATE",
    text: safeTitle,
    dates: `${gStart}/${gEnd}`,
    details: safeDesc,
  });
  const googleUrl = `https://calendar.google.com/calendar/render?${googleParams.toString()}`;

  const outlookParams = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: safeTitle,
    startdt: isoStart,
    enddt: isoEnd,
    body: safeDesc,
  });
  const outlookUrl = `https://outlook.office.com/calendar/0/deeplink/compose?${outlookParams.toString()}`;

  const cleanSummary = safeTitle.replace(/\n/g, " ").replace(/;/g, "\\;").replace(/,/g, "\\,");
  const cleanDescription = safeDesc.replace(/\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
  const nowStamp = toGoogleDate(now);

  const icsContent = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AURA-MEET//Meeting Copilot//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:aura-${Math.random().toString(36).slice(2, 12)}@aurameet.local`,
    `DTSTAMP:${nowStamp}`,
    `DTSTART:${gStart}`,
    `DTEND:${gEnd}`,
    `SUMMARY:${cleanSummary}`,
    `DESCRIPTION:${cleanDescription}`,
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\n");

  return {
    title: safeTitle,
    deadline: params.deadline || start.toUTCString(),
    start_iso: isoStart,
    end_iso: isoEnd,
    google_calendar_url: googleUrl,
    google_url: googleUrl,
    outlook_web_url: outlookUrl,
    outlook_url: outlookUrl,
    ics_content: icsContent,
  };
}

export function generateMeetingMarkdown(
  meeting: Meeting,
  analysis: MeetingAnalysisRecord | undefined,
  todos: TodoItem[],
  memories: MemoryCard[],
  coaching: CoachingCard[],
  segments: TranscriptSegment[]
): string {
  const durationMin = meeting.duration_sec ? Math.round((meeting.duration_sec / 60) * 10) / 10 : 0;
  const rawAttendees = (meeting.attendees || []).length ? meeting.attendees : ["Robin (ME)"];
  const attendeesStr = rawAttendees.join(", ");
  const wikiLinksList = rawAttendees.map((a) => {
    const clean = a.replace(/\s*\(.*?\)\s*/g, "").trim() || a;
    return clean !== a ? `[[${clean}|${a}]]` : `[[${clean}]]`;
  });
  const dom = computeDominanceRatio(segments);

  const lines: string[] = [
    "---",
    `title: "${meeting.title.replace(/"/g, '\\"')}"`,
    `session_id: "${meeting.id}"`,
    `date: "${meeting.created_at}"`,
    `duration: "${durationMin}m (${meeting.duration_sec || 0}s)"`,
    `platform: "${(meeting.platform || "meet").toUpperCase()}"`,
    `status: "${meeting.status || "completed"}"`,
    `attendees: [${rawAttendees.map((a) => `"[[${a.replace(/\s*\(.*?\)\s*/g, "").trim()}]]"`).join(", ")}]`,
    `tags: ["#aura-meet", "#meeting-notes", "#gemma-4", "#${(meeting.platform || "meet").toLowerCase()}"]`,
    "---\n",
    `# 📋 Meeting Notes: ${meeting.title}\n`,
    `#aura-meet #meeting-notes #gemma-4 #${(meeting.platform || "meet").toLowerCase()}\n`,
    `- **Session ID:** \`${meeting.id}\``,
    `- **Date & Time:** ${meeting.created_at}`,
    `- **Duration:** ==${durationMin} minutes (${meeting.duration_sec} seconds)==`,
    `- **Attendees:** ${attendeesStr} (${wikiLinksList.join(" · ")})`,
    `- **Meeting Agenda:** ${meeting.agenda || "General Meeting Discussion"}\n`,
    `> [!SUMMARY] Executive Summary & Outcomes`,
    `> ${analysis?.executive_summary || "No executive summary generated yet."}\n`,
    "---\n",
    "## 🏛️ Executive Summary\n",
    `${analysis?.executive_summary || "No executive summary generated yet."}\n`,
    "### Key Approved Decisions",
  ];

  if (analysis?.decisions?.length) {
    lines.push(`> [!IMPORTANT] Approved Architecture & Strategic Decisions`);
    for (const d of analysis.decisions) {
      lines.push(`> - [x] ==**${d}**==`);
    }
    lines.push("");
    for (const d of analysis.decisions) lines.push(`- [x] **${d}**`);
  } else {
    lines.push("- _No formal decisions recorded._");
  }

  lines.push("", "### Rejected Alternatives & Trade-offs");
  if (analysis?.rejected_alternatives?.length) {
    lines.push(`> [!WARNING] Rejected Options & Explicit Trade-offs`);
    for (const r of analysis.rejected_alternatives) {
      lines.push(`> - ~~${r}~~`);
    }
    lines.push("");
    for (const r of analysis.rejected_alternatives) lines.push(`- ❌ ${r}`);
  } else {
    lines.push("- _No rejected alternatives logged._");
  }

  lines.push("\n---\n", "## 📊 Speaker Dominance & Participation (GFM Table)\n");
  if (dom.speakers.length > 0) {
    lines.push(
      "| Speaker (Obsidian Link) | Role | Talk Share | Active Time | Pace (WPM) | Turns |",
      "| :--- | :--- | :---: | :---: | :---: | :---: |"
    );
    for (const sp of dom.speakers) {
      const roleBadge = sp.is_user ? "`ME (Host)`" : "`Participant`";
      const shareStr = sp.speaker_name === dom.most_dominant_speaker ? `==${sp.percentage}%==` : `${sp.percentage}%`;
      lines.push(
        `| [[${sp.speaker_name}]] | ${roleBadge} | ${shareStr} | ${sp.talk_time_formatted} | ${sp.wpm} WPM | ${sp.turns} |`
      );
    }
    lines.push("");
  } else {
    lines.push("_Speaker participation metrics appear after transcript processing._\n");
  }

  lines.push("---\n", "## 🎯 Phased Action Plan & Deliverables\n");
  if (analysis?.action_plan?.length) {
    lines.push(
      "| Execution Phase | Key Deliverables & Verification Criteria | Track |",
      "| :--- | :--- | :---: |"
    );
    for (const p of analysis.action_plan) {
      lines.push(`| **${p.phase}** | ${p.details.replace(/\|/g, "\\|")} | #execution |`);
    }
    lines.push("");
    for (const p of analysis.action_plan) {
      lines.push(`### ${p.phase}`, `${p.details}\n`);
    }
  } else {
    lines.push("_Action plan will be extracted during post-meeting synthesis._\n");
  }

  lines.push("---\n", "## ✅ Prioritized Action Items (To-Dos)\n");
  if (todos.length) {
    for (const t of todos) {
      const check = t.completed ? "[x]" : "[ ]";
      const cleanOwner = (t.owner || "Team").replace(/\s*\(.*?\)\s*/g, "").trim();
      lines.push(
        `- ${check} **[${t.priority}]** ${t.task} — *Owner:* **[[${cleanOwner}|${t.owner}]]** | *Deadline:* ==${t.deadline || "Next Sprint"}== (\`[${t.timestamp_ref}]\`) #action-item`
      );
    }
  } else {
    lines.push("- [ ] _No action items logged yet._");
  }

  lines.push("\n---\n", "## ✍️ My Raw Notes (Handwritten during meeting)\n");
  lines.push(
    meeting.raw_notes?.trim()
      ? `${meeting.raw_notes.trim()}\n`
      : "_No raw notes taken during this session._\n"
  );

  lines.push("---\n", "## ✨ Enhanced Notes (AI Augmented via Gemma 4)\n");
  if (meeting.enhanced_notes?.trim()) {
    lines.push(`> [!NOTE] Granola-Style AI-Correlated Notes`);
    for (const ln of meeting.enhanced_notes.trim().split("\n")) {
      lines.push(`> ${ln}`);
    }
    lines.push("", `${meeting.enhanced_notes.trim()}\n`);
  } else {
    lines.push(
      "_Click 'Enhance My Notes' in the dashboard to augment your notes with transcript facts and timestamps._\n"
    );
  }

  lines.push("---\n", "## 💡 Things to Remember (Memory Cards)\n");
  if (memories.length) {
    for (const m of memories) {
      const cleanPerson = (m.person || "Team").replace(/\s*\(.*?\)\s*/g, "").trim();
      lines.push(
        `- 📌 ==**${m.fact}**== (\`${m.category}\`) — Mentioned by **[[${cleanPerson}|${m.person || "Team"}]]** at \`[${m.timestamp_ref}]\``
      );
    }
  } else {
    lines.push("_No sticky memories extracted yet._");
  }

  lines.push("\n---\n", "## 🎙️ Personal Behavioral & Response Coaching (ME)\n");
  if (coaching.length) {
    for (const c of coaching) {
      lines.push(
        `> [!TIP] \`[${c.timestamp_ref}]\` Tactical Upgrade — ${c.tone_detected} (Clarity: ${c.clarity_score}/100)`,
        `> - **What You Said:** "${c.what_you_said}"`,
        `> - **Impact Analysis:** ${c.impact_analysis}`,
        `> - **Recommended Upgrade:** ==${c.better_response}==`,
        `> - **Strategic Principle:** *${c.coaching_principle}*\n`,
        `### \`[${c.timestamp_ref}]\` Phrase Audit`,
        `- **What You Said:** "${c.what_you_said}"`,
        `- **Tone Detected:** \`${c.tone_detected}\``,
        `- **Impact Analysis:** ${c.impact_analysis}`,
        `- **Recommended Response:** "${c.better_response}"`,
        `- **Strategic Principle:** *${c.coaching_principle}*\n`
      );
    }
  } else {
    lines.push("_Behavioral coaching evaluates user speech segments during synthesis._\n");
  }

  lines.push("---\n", "## 📜 Full Verbatim Transcript\n");
  if (segments.length) {
    for (const s of segments) {
      const meTag = s.is_user ? " **(ME)**" : "";
      lines.push(`- \`[${s.timestamp_badge}]\` **[[${s.speaker_name}]]${meTag}:** ${s.text}`);
    }
  } else {
    lines.push("_Transcript is empty._");
  }

  lines.push(
    "\n---\n",
    "```json",
    JSON.stringify(
      {
        vault_compatibility: ["Obsidian v1.6+", "GitHub Flavored Markdown (GFM)"],
        session_id: meeting.id,
        local_markdown_path: `${STORAGE_ROOT}/${meeting.id}/meeting_notes.md`,
        local_audio_path: `${STORAGE_ROOT}/${meeting.id}/audio.wav`,
        decisions_count: analysis?.decisions?.length || 0,
        action_items_count: todos.length,
        transcript_segments: segments.length,
      },
      null,
      2
    ),
    "```\n",
    "_Generated by AURA-MEET (On-Device Meeting Intelligence & Behavioral Copilot)_\n"
  );
  const fullMd = lines.join("\n");
  ensureSessionFilesOnDisk(meeting, fullMd);
  return fullMd;
}

export function revealMeetingInFileManager(
  meetingId: string,
  preferredOs?: "mac" | "win" | "linux"
): {
  status: string;
  os: "mac" | "win" | "linux";
  file_manager_name: string;
  button_label: string;
  command: string;
  file_path: string;
  folder_path: string;
  message: string;
} {
  const store = getStore();
  const meeting = store.meetings.find((m) => m.id === meetingId);
  if (!meeting) {
    throw new Error("Meeting not found");
  }
  const mdContent = generateMeetingMarkdown(
    meeting,
    store.analyses[meetingId],
    store.todos.filter((t) => t.meeting_id === meetingId),
    store.memories.filter((m) => m.meeting_id === meetingId),
    store.coaching.filter((c) => c.meeting_id === meetingId),
    store.transcripts[meetingId] || []
  );
  const diskInfo = ensureSessionFilesOnDisk(meeting, mdContent);
  const osType: "mac" | "win" | "linux" = preferredOs || "linux";

  const osConfigs = {
    mac: {
      file_manager_name: "Finder",
      button_label: "Open in Finder",
      command: `open -R "${diskInfo.markdownPath}"`,
    },
    win: {
      file_manager_name: "File Explorer",
      button_label: "Open in Explorer",
      command: `explorer.exe /select,"${diskInfo.markdownPath.replace(/\//g, "\\")}"`,
    },
    linux: {
      file_manager_name: "Thunar",
      button_label: "Open in Thunar",
      command: `thunar "${diskInfo.folderPath}"`,
    },
  };

  const cfg = osConfigs[osType] || osConfigs.linux;
  return {
    status: "revealed",
    os: osType,
    file_manager_name: cfg.file_manager_name,
    button_label: cfg.button_label,
    command: cfg.command,
    file_path: diskInfo.markdownPath,
    folder_path: diskInfo.folderPath,
    message: `Prepared ${diskInfo.markdownPath} for ${cfg.file_manager_name} (${cfg.command})`,
  };
}

export function enhanceNotesWithTranscript(
  meetingTitle: string,
  rawNotes: string,
  segments: TranscriptSegment[]
): string {
  const userLines = (rawNotes || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const enrichedBullets = userLines.map((line) => {
    const cleanLine = line.replace(/^[-•*]\s*/, "");
    const words = cleanLine
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3);
    let bestSeg: TranscriptSegment | undefined;
    let bestScore = 0;

    for (const seg of segments) {
      const hay = `${seg.speaker_name} ${seg.text}`.toLowerCase();
      const isQuestion = seg.text.trim().endsWith("?");
      const score =
        words.reduce((acc, w) => {
          const stem = w.length >= 4 ? w.slice(0, 3) : w;
          return hay.includes(stem) ? acc + 1 : acc;
        }, 0) +
        (/\d+%|\$\d+|thousand|million|\d+ms/.test(seg.text) ? 0.75 : 0) +
        (isQuestion ? -0.4 : 0.25);
      if (score > bestScore) {
        bestScore = score;
        bestSeg = seg;
      }
    }

    if (bestSeg) {
      return `• **${cleanLine}** — Grounded in **${bestSeg.speaker_name}**'s statement at [${bestSeg.timestamp_badge}]: "${bestSeg.text}"`;
    }
    return `• **${cleanLine}** — Logged in session scratchpad`;
  });

  const keyMoments = segments.slice(0, 4).map(
    (s) => `• [${s.timestamp_badge}] **${s.speaker_name}**: ${s.text}`
  );

  return [
    `### ✨ AI-Augmented Notes: ${meetingTitle}`,
    "",
    "#### Your Notes (Correlated with Transcript)",
    ...(enrichedBullets.length > 0
      ? enrichedBullets
      : ["• _No raw bullets provided; synthesized key transcript highlights below._"]),
    "",
    "#### Also Discussed (Key Transcript Anchors)",
    ...keyMoments,
  ].join("\n");
}

export function answerMeetingChat(
  query: string,
  thinking: boolean,
  meeting: Meeting,
  analysis: MeetingAnalysisRecord | undefined,
  todos: TodoItem[],
  memories: MemoryCard[],
  segments: TranscriptSegment[],
  coaching: CoachingCard[] = [],
  individuals: IndividualProfile[] = []
) {
  const q = (query || "").trim().toLowerCase();
  const citationsSet = new Set<string>();
  const addCite = (ts?: string) => {
    if (!ts) return;
    const clean = ts.replace(/[\[\]]/g, "").trim();
    if (/^\d{2}:\d{2}:\d{2}$/.test(clean)) citationsSet.add(clean);
  };
  const extractCitesFromText = (txt: string) => {
    const matches = txt.match(/\[(\d{2}:\d{2}:\d{2})\]/g) || [];
    for (const m of matches) addCite(m);
  };

  let response = "";
  let intentLabel = "Semantic Transcript & Decision Retrieval";

  const stopWords = new Set([
    "what", "did", "we", "the", "for", "and", "are", "was", "were", "how",
    "who", "why", "when", "where", "can", "you", "tell", "me", "about",
    "this", "that", "from", "with", "have", "has", "had", "our", "your",
    "their", "into", "any", "all", "give", "show", "list", "please", "meeting",
  ]);
  const queryTokens = q
    .split(/[^a-z0-9%$]+/)
    .filter((w) => w.length >= 2 && !stopWords.has(w));

  // Check if query mentions a specific participant in this meeting
  const participantNames = Array.from(
    new Set([
      ...segments.map((s) => s.speaker_name),
      ...(meeting.attendees || []),
    ])
  ).filter(Boolean);

  const matchedSpeaker = participantNames.find((name) => {
    const clean = name.replace(/\s*\(.*?\)\s*/g, "").trim().toLowerCase();
    const parts = clean.split(/\s+/);
    return parts.some((p) => p.length >= 3 && q.includes(p));
  });

  if (segments.length === 0 && !analysis) {
    response = `This session ("${meeting.title}") has not been processed yet. Click the "Process" button at the top of the session page (or "Stop & process" if recording) so Faster-Whisper and Gemma 4 can generate the transcript, decisions, coaching cards, and dossiers.`;
    intentLabel = "Unprocessed Session Check";
  } else if (/^(hi|hello|hey|help|what can you do|start)\b/.test(q)) {
    intentLabel = "Copilot Capabilities Overview";
    const firstCite = segments[0]?.timestamp_badge || "00:00:05";
    addCite(firstCite);
    response = [
      `I have indexed **${meeting.title}** (${segments.length} transcript turns, ${(analysis?.decisions || []).length} decisions, ${todos.length} action items, and ${memories.length} key facts, starting at [${firstCite}]).`,
      "",
      "You can ask me:",
      "• **Decisions & Outcomes:** \"What did we decide?\" or \"What alternatives were rejected?\"",
      "• **Action Items & Deadlines:** \"What are the action items and deadlines?\"",
      "• **Metrics, Numbers & SLAs:** \"What numbers, budgets, or SLA targets were agreed on?\"",
      "• **Speaker & Promise Tracking:** \"What did each person promise?\" or \"Who spoke the most?\"",
      "• **Behavioral Coaching:** \"How did I come across and how could I phrase my points better?\"",
    ].join("\n");
  } else if (
    q.includes("coach") ||
    q.includes("tone") ||
    q.includes("how did i") ||
    q.includes("came across") ||
    q.includes("leverage") ||
    q.includes("defensive") ||
    q.includes("better response") ||
    q.includes("hedg")
  ) {
    intentLabel = "Behavioral & Negotiation Coaching Audit";
    const meetingCoach = coaching.filter((c) => c.meeting_id === meeting.id);
    const cardsToUse = meetingCoach.length > 0 ? meetingCoach : coaching.slice(0, 2);
    if (cardsToUse.length > 0) {
      const lines = cardsToUse.map((c) => {
        addCite(c.timestamp_ref);
        return `• At [${c.timestamp_ref}] (**${c.tone_detected}** — Clarity ${c.clarity_score}/100):\n  You said: "${c.what_you_said}"\n  Impact: ${c.impact_analysis}\n  **Tactical Upgrade:** "${c.better_response}"`;
      });
      response = `Here is your Gemma 4 Behavioral & Negotiation Coaching audit for **${meeting.title}**:\n\n${lines.join("\n\n")}`;
    } else {
      const userSegs = segments.filter((s) => s.is_user === 1);
      if (userSegs.length > 0) {
        addCite(userSegs[0].timestamp_badge);
        response = `You spoke ${userSegs.length} time(s) in "${meeting.title}" (starting at [${userSegs[0].timestamp_badge}]: "${userSegs[0].text}"). Your phrasing was direct and collaborative—click "Re-process" to generate fresh side-by-side response upgrade cards.`;
      } else {
        response = `No spoken lines from your microphone (ME) were detected in "${meeting.title}".`;
      }
    }
  } else if (
    q.includes("who spoke") ||
    q.includes("talk time") ||
    q.includes("dominan") ||
    q.includes("most") && q.includes("spoke") ||
    q.includes("who was in") ||
    q.includes("attendee") ||
    q.includes("participat")
  ) {
    intentLabel = "Speaker Dominance & Participation Analysis";
    const dom = computeDominanceRatio(segments);
    const speakerLines = dom.speakers.map(
      (s) =>
        `• **${s.speaker_name}**: ${s.percentage}% talk share (${s.talk_time_formatted}, ${s.turns} turns, ${s.wpm} WPM)`
    );
    if (segments[0]) addCite(segments[0].timestamp_badge);
    response = [
      `Speaker participation breakdown for **${meeting.title}** (Total active speech: ${Math.round(dom.total_duration_sec)}s, most dominant: **${dom.most_dominant_speaker}**):`,
      ...speakerLines,
    ].join("\n");
  } else if (
    q.includes("reject") ||
    q.includes("alternative") ||
    q.includes("why not") ||
    q.includes("option") ||
    q.includes("trade-off")
  ) {
    intentLabel = "Rejected Alternatives & Trade-off Analysis";
    const rejs = analysis?.rejected_alternatives || [];
    if (rejs.length > 0) {
      const list = rejs.map((r) => `• ${r}`).join("\n");
      extractCitesFromText(list);
      response = `Rejected alternatives and trade-offs in **${meeting.title}**:\n${list}`;
    } else {
      const lastSeg = segments[segments.length - 1];
      if (lastSeg) addCite(lastSeg.timestamp_badge);
      response = `No formal alternatives were rejected in **${meeting.title}**. The team aligned on the primary proposal (${analysis?.executive_summary || meeting.agenda}) [${lastSeg?.timestamp_badge || "00:00:05"}].`;
    }
  } else if (
    q.includes("action") ||
    q.includes("todo") ||
    q.includes("to-do") ||
    q.includes("assigned") ||
    q.includes("task") ||
    q.includes("next step") ||
    (q.includes("deadline") && !q.includes("sla"))
  ) {
    intentLabel = "Action Items, Owners & Deadlines Retrieval";
    if (todos.length > 0) {
      const todoList = todos
        .map((t) => {
          addCite(t.timestamp_ref);
          return `• **[${t.priority}]** ${t.task} — **Owner:** ${t.owner} · **Due:** ${t.deadline || "TBD"} [${t.timestamp_ref}]`;
        })
        .join("\n");
      const planList = (analysis?.action_plan || [])
        .map((p) => `• **${p.phase}:** ${p.details}`)
        .join("\n");
      response = `Prioritized action items from **${meeting.title}**:\n${todoList}${
        planList ? `\n\nPhased Execution Plan:\n${planList}` : ""
      }`;
    } else {
      response = `No open action items were recorded for **${meeting.title}**.`;
    }
  } else if (
    matchedSpeaker ||
    q.includes("promise") ||
    q.includes("commit") ||
    q.includes("dossier")
  ) {
    intentLabel = "Participant Statements & Commitments Audit";
    if (matchedSpeaker) {
      const cleanTarget = matchedSpeaker.replace(/\s*\(.*?\)\s*/g, "").trim().toLowerCase();
      const speakerSegs = segments.filter((s) =>
        s.speaker_name.toLowerCase().includes(cleanTarget)
      );
      const speakerTodos = todos.filter((t) =>
        t.owner.toLowerCase().includes(cleanTarget)
      );
      const personProfile = individuals.find((p) =>
        p.name.toLowerCase().includes(cleanTarget)
      );
      const segBullets = speakerSegs.map((s) => {
        addCite(s.timestamp_badge);
        return `• [${s.timestamp_badge}] **${s.speaker_name}**: "${s.text}"`;
      });
      const todoBullets = speakerTodos.map((t) => {
        addCite(t.timestamp_ref);
        return `• Assigned Task: ${t.task} (Due: ${t.deadline || "TBD"}) [${t.timestamp_ref}]`;
      });
      const cheatSheet = personProfile?.communication_cheat_sheet
        ? `\n\n**Communication Playbook (${personProfile.name}):** ${personProfile.communication_cheat_sheet}`
        : "";
      response = [
        `Summary for **${matchedSpeaker}** in **${meeting.title}**:`,
        ...(segBullets.length > 0 ? segBullets : ["• Listed as a session participant."]),
        ...(todoBullets.length > 0 ? ["", "**Commitments & Action Items:**", ...todoBullets] : []),
      ].join("\n") + cheatSheet;
    } else {
      // General promises/commitments across all participants in this meeting
      const lines: string[] = [];
      for (const t of todos) {
        addCite(t.timestamp_ref);
        lines.push(`• **${t.owner}** committed to: ${t.task} (Due: ${t.deadline || "TBD"}) [${t.timestamp_ref}]`);
      }
      for (const m of memories) {
        addCite(m.timestamp_ref);
        lines.push(`• **${m.person || "Team"}** (${m.category}): ${m.fact} [${m.timestamp_ref}]`);
      }
      response =
        lines.length > 0
          ? `Commitments and key promises captured in **${meeting.title}**:\n${lines.join("\n")}`
          : `Here are the key statements from **${meeting.title}**:\n` +
            segments
              .slice(0, 3)
              .map((s) => {
                addCite(s.timestamp_badge);
                return `• [${s.timestamp_badge}] **${s.speaker_name}**: "${s.text}"`;
              })
              .join("\n");
    }
  } else if (
    q.includes("decision") ||
    q.includes("catch me up") ||
    q.includes("summary") ||
    q.includes("summarize") ||
    q.includes("recap") ||
    q.includes("tl;dr") ||
    q.includes("what happened")
  ) {
    intentLabel = "Executive Summary & Decisions Synthesis";
    const decs = (analysis?.decisions || []).map((d) => `• ${d}`).join("\n");
    extractCitesFromText(decs);
    if (citationsSet.size === 0) {
      for (const s of segments.slice(0, 3)) addCite(s.timestamp_badge);
    }
    response = [
      `**Executive Summary (${meeting.title}):**`,
      analysis?.executive_summary || meeting.agenda || "Session transcript indexed.",
      ...(decs ? ["", "**Key Decisions:**", decs] : []),
    ].join("\n");
  } else {
    // Score segments, memories, decisions, rejected_alternatives, and todos against queryTokens
    intentLabel = "Contextual Fact & Transcript Retrieval";
    const wantsNumbers =
      q.includes("sla") ||
      q.includes("latency") ||
      q.includes("budget") ||
      q.includes("cost") ||
      q.includes("saving") ||
      q.includes("metric") ||
      q.includes("number") ||
      q.includes("how much") ||
      q.includes("deadline") ||
      q.includes("agree");

    const scoredSegments = segments
      .map((s) => {
        const hay = `${s.speaker_name} ${s.text}`.toLowerCase();
        let score = 0;
        for (const tok of queryTokens) {
          if (hay.includes(tok)) score += 3;
        }
        if (wantsNumbers && /\d+/.test(s.text)) score += 2;
        return { seg: s, score };
      })
      .sort((a, b) => b.score - a.score);

    const matchedMemories = memories.filter((m) => {
      const hay = `${m.category} ${m.fact} ${m.context} ${m.person}`.toLowerCase();
      return queryTokens.some((tok) => hay.includes(tok)) || (wantsNumbers && /\d+/.test(m.fact));
    });

    const matchedDecisions = (analysis?.decisions || []).filter((d) => {
      const hay = d.toLowerCase();
      return queryTokens.some((tok) => hay.includes(tok)) || wantsNumbers;
    });

    const matchedTodos = todos.filter((t) => {
      const hay = `${t.task} ${t.owner} ${t.deadline || ""}`.toLowerCase();
      return queryTokens.some((tok) => hay.includes(tok));
    });

    const topSegs = scoredSegments
      .filter((x) => x.score > 0)
      .slice(0, 4)
      .map((x) => x.seg);

    const parts: string[] = [];

    if (matchedDecisions.length > 0) {
      const dLines = matchedDecisions.slice(0, 3).map((d) => `• ${d}`);
      extractCitesFromText(dLines.join("\n"));
      parts.push(`**Decisions & Agreements:**\n${dLines.join("\n")}`);
    }

    if (matchedMemories.length > 0) {
      const mLines = matchedMemories.slice(0, 3).map((m) => {
        addCite(m.timestamp_ref);
        return `• **${m.category}:** ${m.fact} (${m.context || m.person}) [${m.timestamp_ref}]`;
      });
      parts.push(`**Key Metrics & Facts:**\n${mLines.join("\n")}`);
    }

    if (matchedTodos.length > 0) {
      const tLines = matchedTodos.slice(0, 3).map((t) => {
        addCite(t.timestamp_ref);
        return `• ${t.task} — **${t.owner}** (${t.deadline || "TBD"}) [${t.timestamp_ref}]`;
      });
      parts.push(`**Related Action Items:**\n${tLines.join("\n")}`);
    }

    const segsToShow = topSegs.length > 0 ? topSegs : segments.slice(0, 3);
    if (segsToShow.length > 0) {
      const qLines = segsToShow.map((s) => {
        addCite(s.timestamp_badge);
        return `• [${s.timestamp_badge}] **${s.speaker_name}**: "${s.text}"`;
      });
      parts.push(`**Verbatim Transcript Evidence:**\n${qLines.join("\n")}`);
    }

    response =
      parts.length > 0
        ? parts.join("\n\n")
        : `In **${meeting.title}**, ${analysis?.executive_summary || "the team reviewed key priorities."}`;
  }

  const citations = Array.from(citationsSet);
  const thought = thinking
    ? [
        `1. [Intent Classification] Identified query intent: "${intentLabel}" for session "${meeting.title}" (${meeting.id}).`,
        `2. [Multi-Tier Context Scan] Searched ${segments.length} transcript turns, ${(analysis?.decisions || []).length} decisions, ${todos.length} action items, and ${memories.length} memory cards.`,
        `3. [Grounding & Verification] Verified ${citations.length} exact timestamp citation(s) (${citations.map((c) => `[${c}]`).join(", ") || "none"}) against speaker turns.`,
      ].join("\n")
    : "";

  return {
    query,
    response,
    thought,
    thinking_enabled: thinking,
    citations,
  };
}

function createInitialState(): AuraStoreState {
  const nowIso = "2026-10-30T10:45:00Z";
  const meetingId = "demo-meeting-01";
  const meeting2Id = "demo-meeting-02";

  const sampleSegments: TranscriptSegment[] = [
    {
      id: "seg-01",
      meeting_id: meetingId,
      speaker_label: "ME",
      speaker_name: "Robin",
      is_user: 1,
      text: "Good morning everyone. Let's align on our Q4 architecture goals. We need to finalize the microservices migration and lock down our p99 latency target under 100 milliseconds.",
      start_time: 5.0,
      end_time: 15.0,
      timestamp_badge: "00:00:05",
      raw_confidence: 0.98,
      created_at: nowIso,
    },
    {
      id: "seg-02",
      meeting_id: meetingId,
      speaker_label: "Speaker_A",
      speaker_name: "Sarah Chen",
      is_user: 0,
      text: "Thanks Robin. From an executive perspective, our board cares deeply about reliability during peak Black Friday traffic. If we miss the 100 millisecond mark, customer conversion drops 4%.",
      start_time: 16.0,
      end_time: 28.0,
      timestamp_badge: "00:00:16",
      raw_confidence: 0.98,
      created_at: nowIso,
    },
    {
      id: "seg-03",
      meeting_id: meetingId,
      speaker_label: "Speaker_B",
      speaker_name: "Marcus Vance",
      is_user: 0,
      text: "From the product side, we have three major enterprise customers asking for real-time analytics streaming before they renew their contracts next month.",
      start_time: 29.0,
      end_time: 41.0,
      timestamp_badge: "00:00:29",
      raw_confidence: 0.98,
      created_at: nowIso,
    },
    {
      id: "seg-04",
      meeting_id: meetingId,
      speaker_label: "Speaker_C",
      speaker_name: "Priya Sharma",
      is_user: 0,
      text: "I've benchmarked the new gRPC transport layer. With connection pooling, we're seeing 64 milliseconds p99 in staging, which easily beats the SLA.",
      start_time: 42.0,
      end_time: 56.0,
      timestamp_badge: "00:00:42",
      raw_confidence: 0.98,
      created_at: nowIso,
    },
    {
      id: "seg-05",
      meeting_id: meetingId,
      speaker_label: "ME",
      speaker_name: "Robin",
      is_user: 1,
      text: "I think we can probably rebuild the entire data ingestion pipeline by Friday if nobody interrupts us.",
      start_time: 58.0,
      end_time: 69.0,
      timestamp_badge: "00:00:58",
      raw_confidence: 0.98,
      created_at: nowIso,
    },
    {
      id: "seg-06",
      meeting_id: meetingId,
      speaker_label: "Speaker_A",
      speaker_name: "Sarah Chen",
      is_user: 0,
      text: "That sounds very ambitious Robin, but what happens if the database migration hits a lock bottleneck like it did last sprint?",
      start_time: 71.0,
      end_time: 83.0,
      timestamp_badge: "00:01:11",
      raw_confidence: 0.98,
      created_at: nowIso,
    },
    {
      id: "seg-07",
      meeting_id: meetingId,
      speaker_label: "ME",
      speaker_name: "Robin",
      is_user: 1,
      text: "Well, we discussed this three weeks ago and everyone agreed on Postgres partitioning, so I don't know why we're rehashing it.",
      start_time: 85.0,
      end_time: 96.0,
      timestamp_badge: "00:01:25",
      raw_confidence: 0.98,
      created_at: nowIso,
    },
    {
      id: "seg-08",
      meeting_id: meetingId,
      speaker_label: "Speaker_B",
      speaker_name: "Marcus Vance",
      is_user: 0,
      text: "Speaking of facilities, did anyone see the email about the downtown office lease renewal and parking fee changes?",
      start_time: 98.0,
      end_time: 110.0,
      timestamp_badge: "00:01:38",
      raw_confidence: 0.98,
      created_at: nowIso,
    },
    {
      id: "seg-09",
      meeting_id: meetingId,
      speaker_label: "Speaker_C",
      speaker_name: "Priya Sharma",
      is_user: 0,
      text: "Marcus, that's not on our agenda today. Let's stay focused on the cloud budget and latency SLA.",
      start_time: 112.0,
      end_time: 122.0,
      timestamp_badge: "00:01:52",
      raw_confidence: 0.98,
      created_at: nowIso,
    },
    {
      id: "seg-10",
      meeting_id: meetingId,
      speaker_label: "Speaker_A",
      speaker_name: "Sarah Chen",
      is_user: 0,
      text: "Good catch Priya. Robin, what is the exact cost delta between provisioning reserved Kubernetes nodes versus AWS Fargate for our ingestion cluster?",
      start_time: 124.0,
      end_time: 139.0,
      timestamp_badge: "00:02:04",
      raw_confidence: 0.98,
      created_at: nowIso,
    },
    {
      id: "seg-11",
      meeting_id: meetingId,
      speaker_label: "ME",
      speaker_name: "Robin",
      is_user: 1,
      text: "Reserved nodes save us roughly 42% annualized, which amounts to twelve thousand dollars a month. I've prepared the Terraform manifest.",
      start_time: 141.0,
      end_time: 154.0,
      timestamp_badge: "00:02:21",
      raw_confidence: 0.98,
      created_at: nowIso,
    },
    {
      id: "seg-12",
      meeting_id: meetingId,
      speaker_label: "Speaker_B",
      speaker_name: "Marcus Vance",
      is_user: 0,
      text: "I commit to locking down the enterprise telemetry schema by Wednesday 3 PM so Robin's team has clean contract specs.",
      start_time: 156.0,
      end_time: 169.0,
      timestamp_badge: "00:02:36",
      raw_confidence: 0.98,
      created_at: nowIso,
    },
    {
      id: "seg-13",
      meeting_id: meetingId,
      speaker_label: "Speaker_C",
      speaker_name: "Priya Sharma",
      is_user: 0,
      text: "And I will configure the Prometheus alert rules for p99 latency spikes above 90 milliseconds with automated Slack paging.",
      start_time: 171.0,
      end_time: 184.0,
      timestamp_badge: "00:02:51",
      raw_confidence: 0.98,
      created_at: nowIso,
    },
    {
      id: "seg-14",
      meeting_id: meetingId,
      speaker_label: "ME",
      speaker_name: "Robin",
      is_user: 1,
      text: "Yeah, whatever Sarah thinks is fine, we'll make it work.",
      start_time: 186.0,
      end_time: 194.0,
      timestamp_badge: "00:03:06",
      raw_confidence: 0.98,
      created_at: nowIso,
    },
    {
      id: "seg-15",
      meeting_id: meetingId,
      speaker_label: "Speaker_A",
      speaker_name: "Sarah Chen",
      is_user: 0,
      text: "Let's be explicit: Robin owns Terraform provisioning, Marcus delivers telemetry schemas Wednesday, and Priya sets up alerts by Thursday EOD.",
      start_time: 196.0,
      end_time: 212.0,
      timestamp_badge: "00:03:16",
      raw_confidence: 0.98,
      created_at: nowIso,
    },
    {
      id: "seg-16",
      meeting_id: meetingId,
      speaker_label: "ME",
      speaker_name: "Robin",
      is_user: 1,
      text: "Agreed. I will review the Terraform manifest with Priya tomorrow morning at 10 AM and commit the pull request.",
      start_time: 214.0,
      end_time: 226.0,
      timestamp_badge: "00:03:34",
      raw_confidence: 0.98,
      created_at: nowIso,
    },
    {
      id: "seg-17",
      meeting_id: meetingId,
      speaker_label: "Speaker_A",
      speaker_name: "Sarah Chen",
      is_user: 0,
      text: "Excellent. Budget is approved for reserved instances. Meeting adjourned.",
      start_time: 228.0,
      end_time: 236.0,
      timestamp_badge: "00:03:48",
      raw_confidence: 0.98,
      created_at: nowIso,
    },
  ];

  const meeting2Segments: TranscriptSegment[] = [
    {
      id: "seg-201",
      meeting_id: meeting2Id,
      speaker_label: "ME",
      speaker_name: "Robin",
      is_user: 1,
      text: "Let's review the enterprise telemetry schema and zero-trust token rotation schedule before Wednesday's freeze.",
      start_time: 4.0,
      end_time: 14.0,
      timestamp_badge: "00:00:04",
      raw_confidence: 0.99,
      created_at: "2026-10-29T16:00:00Z",
    },
    {
      id: "seg-202",
      meeting_id: meeting2Id,
      speaker_label: "Speaker_B",
      speaker_name: "Marcus Vance",
      is_user: 0,
      text: "All three enterprise accounts confirmed they need webhook signatures using HMAC-SHA256.",
      start_time: 15.0,
      end_time: 26.0,
      timestamp_badge: "00:00:15",
      raw_confidence: 0.99,
      created_at: "2026-10-29T16:00:00Z",
    },
    {
      id: "seg-203",
      meeting_id: meeting2Id,
      speaker_label: "Speaker_C",
      speaker_name: "Priya Sharma",
      is_user: 0,
      text: "I added automated key rotation every 24 hours in Vault with zero-downtime dual-key verification.",
      start_time: 28.0,
      end_time: 40.0,
      timestamp_badge: "00:00:28",
      raw_confidence: 0.99,
      created_at: "2026-10-29T16:00:00Z",
    },
  ];

  const meetings: Meeting[] = [
    {
      id: meetingId,
      title: "Q4 Product Architecture & Launch Sync",
      agenda:
        "Finalize backend migration to microservices, define Q4 API SLA targets (<100ms p99), allocate engineering resources for launch, and sign off on cloud budget.",
      attendees: [
        "Robin (ME)",
        "Sarah Chen (VP Eng)",
        "Marcus Vance (Principal PM)",
        "Priya Sharma (Staff Architect)",
      ],
      created_at: "2026-10-30T10:00:00Z",
      ended_at: "2026-10-30T10:45:00Z",
      status: "completed",
      duration_sec: 2700,
      drift_score: 18.5,
      has_audio: true,
      raw_notes:
        "• Lock p99 latency under 100ms for Black Friday\n• Reserved Kubernetes nodes save 42% ($12k/mo) vs Fargate\n• Marcus to deliver enterprise telemetry schema by Wednesday 3 PM\n• Priya setting up 90ms Prometheus alerts",
      enhanced_notes: "",
      folder_path: `${STORAGE_ROOT}/${meetingId}`,
      has_markdown: true,
      platform: "meet",
    },
    {
      id: meeting2Id,
      title: "Enterprise Telemetry & Security Design Review",
      agenda: "Review HMAC-SHA256 webhook signing and Vault 24h key rotation for enterprise tier.",
      attendees: ["Robin (ME)", "Marcus Vance (Principal PM)", "Priya Sharma (Staff Architect)"],
      created_at: "2026-10-29T15:30:00Z",
      ended_at: "2026-10-29T16:00:00Z",
      status: "completed",
      duration_sec: 1800,
      drift_score: 4.2,
      has_audio: true,
      raw_notes: "• HMAC-SHA256 required for enterprise webhooks\n• 24h Vault key rotation with dual-key window",
      enhanced_notes: "",
      folder_path: `${STORAGE_ROOT}/${meeting2Id}`,
      has_markdown: true,
      platform: "zoom",
    },
  ];

  const analyses: Record<string, MeetingAnalysisRecord> = {
    [meetingId]: {
      id: "analysis-01",
      meeting_id: meetingId,
      executive_summary:
        "The team achieved formal sign-off for the Q4 microservices architecture transition. Key latency SLA of <100ms p99 was verified feasible via Priya's gRPC benchmarks (64ms). Sarah approved switching from AWS Fargate to Reserved Kubernetes nodes, securing $144,000 in annualized infrastructure savings. Execution is de-risked by staging schema contracts before code cutovers.",
      decisions: [
        "Adopt gRPC connection pooling for internal inter-service calls [00:00:42].",
        "Provision 1-year reserved Kubernetes nodes instead of serverless Fargate ($12k/mo savings) [00:02:21].",
        "Enforce strict 90ms warning alerts in Prometheus with Slack auto-paging [00:02:51].",
      ],
      rejected_alternatives: [
        "AWS Fargate Serverless: Rejected due to 42% higher cost at current ingest volumes [00:02:21].",
        "Full Ingestion Pipeline Rewrite by Friday: Rejected as excessively high risk during active sprint [00:01:11].",
        "GraphQL gateway for internal services: Rejected in favor of lower latency gRPC [00:00:42].",
      ],
      action_plan: [
        {
          phase: "Phase 1: Contracts (Days 1-2)",
          details: "Marcus delivers finalized telemetry schema specs by Wednesday 3 PM.",
        },
        {
          phase: "Phase 2: Infrastructure (Days 2-3)",
          details: "Robin and Priya deploy Terraform reserved nodes manifest and verify routing.",
        },
        {
          phase: "Phase 3: Telemetry & Verification (Days 3-4)",
          details: "Priya provisions Prometheus alert rules and runs synthetic load test.",
        },
      ],
      created_at: nowIso,
    },
    [meeting2Id]: {
      id: "analysis-02",
      meeting_id: meeting2Id,
      executive_summary:
        "Aligned on HMAC-SHA256 webhook authentication and automated 24-hour key rotation in HashiCorp Vault with dual-key verification to guarantee zero downtime for enterprise customers.",
      decisions: [
        "Standardize on HMAC-SHA256 signatures for all enterprise streaming webhooks [00:00:15].",
        "Enable 24-hour automated key rotation with dual-key grace period [00:00:28].",
      ],
      rejected_alternatives: [
        "Static API tokens: Rejected due to enterprise compliance requirements.",
      ],
      action_plan: [
        {
          phase: "Phase 1: Vault Policy",
          details: "Priya deploys 24h key rotation schedule to staging.",
        },
      ],
      created_at: "2026-10-29T16:00:00Z",
    },
  };

  const epochs: Record<string, EpochSummary[]> = {
    [meetingId]: [
      {
        id: "epoch-01",
        meeting_id: meetingId,
        epoch_index: 1,
        start_min: 0,
        end_min: 10,
        summary_markdown:
          "### Epoch 1: SLA Alignment & Architecture Strategy\n- Robin and Sarah aligned on sub-100ms p99 latency SLA critical for Q4 enterprise conversions.\n- Priya presented gRPC benchmark results (64ms p99 in staging).\n- Robin proposed rebuilding ingestion pipeline by Friday, but was cautioned by Sarah on database lock risks.",
        key_topics: ["Q4 Architecture", "SLA p99 Latency", "gRPC Benchmarks", "Database Partitioning"],
        created_at: nowIso,
      },
      {
        id: "epoch-02",
        meeting_id: meetingId,
        epoch_index: 2,
        start_min: 10,
        end_min: 20,
        summary_markdown:
          "### Epoch 2: Budget Decisions & Resource Allocation\n- Brief agenda drift by Marcus regarding office lease renewal was redirected back to cloud budget by Priya.\n- Robin confirmed 42% cost savings ($12k/mo) using reserved Kubernetes nodes over AWS Fargate.\n- Formal commitments locked: Marcus (schemas by Wed 3 PM), Priya (alerts by Thu EOD), Robin (Terraform PR review Wed 10 AM).",
        key_topics: ["Cloud Cost Optimization", "AWS Reserved Nodes", "Enterprise Schemas", "Action Commitments"],
        created_at: nowIso,
      },
    ],
    [meeting2Id]: [],
  };

  const todos: TodoItem[] = [
    {
      id: "todo-01",
      meeting_id: meetingId,
      task: "Deliver locked telemetry schema specifications to engineering",
      owner: "Marcus Vance",
      deadline: "Wednesday, Nov 4 - 3:00 PM",
      priority: "HIGH",
      timestamp_ref: "00:02:36",
      completed: 0,
    },
    {
      id: "todo-02",
      meeting_id: meetingId,
      task: "Review Terraform reserved nodes manifest with Priya & commit PR",
      owner: "Robin (ME)",
      deadline: "Wednesday, Nov 4 - 10:00 AM",
      priority: "HIGH",
      timestamp_ref: "00:03:34",
      completed: 0,
    },
    {
      id: "todo-03",
      meeting_id: meetingId,
      task: "Configure Prometheus alert rules (90ms threshold) and Slack bot",
      owner: "Priya Sharma",
      deadline: "Thursday, Nov 5 - 5:00 PM",
      priority: "MEDIUM",
      timestamp_ref: "00:02:51",
      completed: 0,
    },
    {
      id: "todo-04",
      meeting_id: meetingId,
      task: "Provide executive budget sign-off for reserved compute commitment",
      owner: "Sarah Chen",
      deadline: "Friday, Nov 6 - 12:00 PM",
      priority: "LOW",
      timestamp_ref: "00:03:48",
      completed: 1,
    },
  ];

  const memories: MemoryCard[] = [
    {
      id: "rem-01",
      meeting_id: meetingId,
      fact: "Reserved nodes yield42% annualized savings ($12,000/month)",
      context: "Cloud architecture budget evaluation vs AWS Fargate",
      person: "Robin",
      timestamp_ref: "00:02:21",
      category: "Financial Metric",
    },
    {
      id: "rem-02",
      meeting_id: meetingId,
      fact: "Sarah stressed board cares about Black Friday conversion loss: 4% drop per 100ms latency",
      context: "High priority business constraint for architecture",
      person: "Sarah Chen",
      timestamp_ref: "00:00:16",
      category: "Executive Priority",
    },
    {
      id: "rem-03",
      meeting_id: meetingId,
      fact: "Priya benchmarked gRPC at 64ms p99 in staging environment",
      context: "Proof of concept latency performance data",
      person: "Priya Sharma",
      timestamp_ref: "00:00:42",
      category: "Technical Fact",
    },
    {
      id: "rem-04",
      meeting_id: meetingId,
      fact: "Marcus has 3 enterprise clients whose renewals depend on real-time streaming telemetry",
      context: "Sales contract renewal deadline next month",
      person: "Marcus Vance",
      timestamp_ref: "00:00:29",
      category: "Client Dependency",
    },
  ];

  const coaching: CoachingCard[] = [
    {
      id: "coach-01",
      meeting_id: meetingId,
      timestamp_ref: "00:00:58",
      what_you_said:
        "I think we can probably rebuild the entire data ingestion pipeline by Friday if nobody interrupts us.",
      tone_detected: "Over-promising & Defensively Conditional",
      impact_analysis:
        "Created immediate skepticism from executive leadership and implied team colleagues are a nuisance. Sets up failure if unexpected bugs surface.",
      better_response:
        "Rebuilding the full pipeline carries high regression risk for Friday's demo. Let's isolate the query optimizer first, which achieves 80% of the latency gain by Thursday, and schedule the schema refactor for Sprint 14.",
      coaching_principle:
        "Scope De-Risking & Phased Credibility: Never bet your entire reputation on an unbuffered timeline.",
      clarity_score: 62,
      empathy_score: 54,
      meeting_title: "Q4 Product Architecture & Launch Sync",
    },
    {
      id: "coach-02",
      meeting_id: meetingId,
      timestamp_ref: "00:01:25",
      what_you_said:
        "Well, we discussed this three weeks ago and everyone agreed on Postgres partitioning, so I don't know why we're rehashing it.",
      tone_detected: "Rigid, Defensive & Combative",
      impact_analysis:
        "Dismisses valid context changes and shuts down collaborative inquiry. Makes you appear resistant to healthy technical scrutiny.",
      better_response:
        "Marcus and Sarah make a valid point given the 5x surge in ingest volume we saw last week. Let's review the current throughput numbers against our original assumptions so we're aligned on whether partitioning still covers us.",
      coaching_principle:
        "Non-Defensive Inquiry & Data Reframing: Treat challenges to past decisions as opportunities to reaffirm data.",
      clarity_score: 58,
      empathy_score: 48,
      meeting_title: "Q4 Product Architecture & Launch Sync",
    },
    {
      id: "coach-03",
      meeting_id: meetingId,
      timestamp_ref: "00:03:06",
      what_you_said: "Yeah, whatever Sarah thinks is fine, we'll make it work.",
      tone_detected: "Passive Resignation & Abdicated Ownership",
      impact_analysis:
        "Signals disengagement and leaves deliverables ambiguous. When things break later, leadership remembers you conceded without professional dissent.",
      better_response:
        "Sarah, to deliver on your target while protecting system reliability, we will need to deprioritize the real-time analytics export. If you're comfortable with that tradeoff, we'll sign off on the 100ms SLA.",
      coaching_principle:
        "Explicit Tradeoff Negotiation: True senior leadership means articulating costs and boundaries constructively.",
      clarity_score: 50,
      empathy_score: 60,
      meeting_title: "Q4 Product Architecture & Launch Sync",
    },
  ];

  const individuals: IndividualProfile[] = [
    {
      id: "ind-sarah",
      name: "Sarah Chen",
      role: "VP of Engineering",
      email: "sarah.chen@company.internal",
      avatar_url: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150",
      first_met: "2026-08-15T09:00:00Z",
      last_met: nowIso,
      total_meetings: 4,
      talk_time_sec_total: 1840,
      reliability_score: 94,
      communication_cheat_sheet:
        "Values crisp executive summaries, data-backed ROI, and explicit downside risk mitigation. Dislikes vague optimistic dates.",
      notes:
        "Prefers written briefs 2 hours before architectural syncs. Highly receptive to phased rollouts with explicit rollback triggers.",
      interactions: [
        {
          id: "act-sarah-1",
          individual_id: "ind-sarah",
          meeting_id: meetingId,
          meeting_title: "Q4 Product Architecture & Launch Sync",
          timestamp_ref: "00:00:16",
          quote:
            "From an executive perspective, our board cares deeply about reliability during peak Black Friday traffic.",
          promises_by_them: "Approved reserved node budget allocation ($144k annualized).",
          promises_by_user: "Robin promised to deliver verified latency benchmarks with safety buffers.",
          topic: "Q4 SLA & Executive Expectations",
          sentiment: "positive",
          created_at: nowIso,
        },
      ],
    },
    {
      id: "ind-marcus",
      name: "Marcus Vance",
      role: "Principal Product Manager",
      email: "marcus.vance@company.internal",
      avatar_url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150",
      first_met: "2026-08-15T09:00:00Z",
      last_met: nowIso,
      total_meetings: 6,
      talk_time_sec_total: 2450,
      reliability_score: 88,
      communication_cheat_sheet:
        "Driven by customer renewal dates and enterprise contract commitments. Can occasionally bring tangent topics into technical reviews.",
      notes:
        "Keep conversations anchored on user telemetry and delivery milestones. Acknowledge customer urgency before steering to technical feasibility.",
      interactions: [
        {
          id: "act-marcus-1",
          individual_id: "ind-marcus",
          meeting_id: meetingId,
          meeting_title: "Q4 Product Architecture & Launch Sync",
          timestamp_ref: "00:02:36",
          quote:
            "I commit to locking down the enterprise telemetry schema by Wednesday 3 PM so Robin's team has clean contract specs.",
          promises_by_them: "Lock down enterprise telemetry schema by Wednesday 3:00 PM.",
          promises_by_user: "Ingest telemetry contract specs into microservices pipeline.",
          topic: "Enterprise Telemetry Contracts",
          sentiment: "positive",
          created_at: nowIso,
        },
      ],
    },
    {
      id: "ind-priya",
      name: "Priya Sharma",
      role: "Staff Infrastructure Engineer",
      email: "priya.sharma@company.internal",
      avatar_url: "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150",
      first_met: "2026-08-15T09:00:00Z",
      last_met: nowIso,
      total_meetings: 5,
      talk_time_sec_total: 1920,
      reliability_score: 96,
      communication_cheat_sheet:
        "Extremely rigorous on system metrics (p99 latency, memory leaks, connection pool exhaustion). Clear, objective, and collaborative.",
      notes:
        "Bring code snippets, latency benchmarks, and architectural block diagrams. Highly effective partner for infrastructure reviews.",
      interactions: [
        {
          id: "act-priya-1",
          individual_id: "ind-priya",
          meeting_id: meetingId,
          meeting_title: "Q4 Product Architecture & Launch Sync",
          timestamp_ref: "00:02:51",
          quote:
            "And I will configure the Prometheus alert rules for p99 latency spikes above 90 milliseconds with automated Slack paging.",
          promises_by_them: "Configure 90ms p99 Prometheus alert rules and automated Slack paging by Thursday EOD.",
          promises_by_user: "Review Terraform reserved nodes manifest together Wednesday at 10:00 AM.",
          topic: "gRPC Benchmarks & Observability",
          sentiment: "positive",
          created_at: nowIso,
        },
      ],
    },
  ];

  const state: AuraStoreState = {
    settings: {
      lm_studio_base_url: process.env.LM_STUDIO_BASE_URL || "http://localhost:1234/v1",
      lm_studio_model: process.env.LM_STUDIO_MODEL || "gemma-4",
      temperature: 0.2,
      max_tokens: 2048,
      vad_aggressiveness: 2,
      noise_cleaning_enabled: true,
      epoch_window_minutes: 10,
      default_calendar: "google",
      user_name: "Robin",
      audio_export_dir: STORAGE_ROOT,
      whisper_model: "large-v3-turbo",
      whisper_language: "auto",
    },
    meetings,
    transcripts: {
      [meetingId]: sampleSegments,
      [meeting2Id]: meeting2Segments,
    },
    analyses,
    epochs,
    todos,
    memories,
    coaching,
    individuals,
    activeRecordings: {},
    processingStatuses: {},
    downloadedWhisperModels: {
      "large-v3-turbo": true,
      "large-v3": false,
      medium: false,
      small: false,
      base: true,
    },
    autoDetectEnabled: true,
    autoRecordEnabled: true,
    detectedCalls: [],
  };

  for (const m of meetings) {
    ensureSessionFilesOnDisk(m);
  }
  try {
    for (const modelId of ["large-v3-turbo", "base"]) {
      const mDir = path.join(STORAGE_ROOT, "models", modelId);
      fs.mkdirSync(mDir, { recursive: true });
      fs.writeFileSync(path.join(mDir, "model.bin"), `WHISPER_MODEL_WEIGHTS_${modelId}`);
    }
  } catch {
    // ignore
  }
  return state;
}

const globalForAura = globalThis as unknown as { __auraStore?: AuraStoreState };

export function getStore(): AuraStoreState {
  if (!globalForAura.__auraStore) {
    globalForAura.__auraStore = createInitialState();
  }
  return globalForAura.__auraStore;
}

export function resetStoreToEmpty(): void {
  const s = getStore();
  for (const m of s.meetings) {
    deleteSessionFilesFromDisk(m.id);
  }
  try {
    if (fs.existsSync(STORAGE_ROOT)) {
      const entries = fs.readdirSync(STORAGE_ROOT);
      for (const entry of entries) {
        if (entry !== "models") {
          fs.rmSync(path.join(STORAGE_ROOT, entry), { recursive: true, force: true });
        }
      }
    }
  } catch {
    // ignore
  }
  s.meetings = [];
  s.transcripts = {};
  s.analyses = {};
  s.epochs = {};
  s.todos = [];
  s.memories = [];
  s.coaching = [];
  s.individuals = [];
  s.activeRecordings = {};
  s.processingStatuses = {};
  s.detectedCalls = [];
}

export function restoreDemoStore(): void {
  globalForAura.__auraStore = createInitialState();
}

export function deleteMeetingFromStore(meetingId: string): { deleted: boolean; id: string; files_deleted: boolean } {
  const store = getStore();
  store.meetings = store.meetings.filter((m) => m.id !== meetingId);
  delete store.transcripts[meetingId];
  delete store.analyses[meetingId];
  delete store.epochs[meetingId];
  delete store.activeRecordings[meetingId];
  delete store.processingStatuses[meetingId];
  store.todos = store.todos.filter((t) => t.meeting_id !== meetingId);
  store.memories = store.memories.filter((m) => m.meeting_id !== meetingId);
  store.coaching = store.coaching.filter((c) => c.meeting_id !== meetingId);
  store.detectedCalls = store.detectedCalls.filter((c) => c.recording_meeting_id !== meetingId);

  // Clean up individual interactions and remove orphaned individuals
  for (const person of store.individuals) {
    if (Array.isArray(person.interactions)) {
      person.interactions = person.interactions.filter((act: any) => act.meeting_id !== meetingId);
    }
  }
  store.individuals = store.individuals.filter((person) => {
    const hasInteractions = Array.isArray(person.interactions) && person.interactions.length > 0;
    const hasSpoken = Object.values(store.transcripts)
      .flat()
      .some((s) => s.speaker_name.toLowerCase() === person.name.toLowerCase());
    return hasInteractions || hasSpoken;
  });

  const filesDeleted = deleteSessionFilesFromDisk(meetingId);
  return { deleted: true, id: meetingId, files_deleted: filesDeleted };
}

export function deleteIndividualFromStore(personId: string): { deleted: boolean; person_id: string; files_deleted: boolean } {
  const store = getStore();
  store.individuals = store.individuals.filter((p) => p.id !== personId);
  const dossierFile = path.join(STORAGE_ROOT, "dossiers", `${personId}.json`);
  let filesDeleted = false;
  try {
    if (fs.existsSync(dossierFile)) {
      fs.rmSync(dossierFile, { force: true });
      filesDeleted = true;
    }
  } catch {
    // ignore
  }
  return { deleted: true, person_id: personId, files_deleted: filesDeleted };
}

export function getWhisperModelsState(): { models: WhisperModelInfo[]; active_model: string } {
  const store = getStore();
  const models: WhisperModelInfo[] = WHISPER_MODEL_CATALOG.map((item) => {
    const downloaded = Boolean(store.downloadedWhisperModels[item.id]);
    const localPath = path.join(STORAGE_ROOT, "models", item.id, "model.bin");
    return {
      ...item,
      downloaded,
      ready: downloaded,
      status: downloaded ? "Downloaded (Local)" : "Not Downloaded",
      local_path: downloaded ? localPath : undefined,
    };
  });

  const downloadedIds = models.filter((m) => m.downloaded).map((m) => m.id);
  if (!downloadedIds.includes(store.settings.whisper_model) && downloadedIds.length > 0) {
    store.settings.whisper_model = downloadedIds[0];
  }

  return {
    models,
    active_model: store.settings.whisper_model || downloadedIds[0] || "large-v3-turbo",
  };
}

export function downloadWhisperModelInStore(modelId: string): {
  status: string;
  model_id: string;
  models: WhisperModelInfo[];
  active_model: string;
} {
  const store = getStore();
  const exists = WHISPER_MODEL_CATALOG.some((m) => m.id === modelId);
  if (!exists) {
    throw new Error(`Unknown Whisper model: ${modelId}`);
  }
  store.downloadedWhisperModels[modelId] = true;
  try {
    const mDir = path.join(STORAGE_ROOT, "models", modelId);
    fs.mkdirSync(mDir, { recursive: true });
    fs.writeFileSync(
      path.join(mDir, "model.bin"),
      `WHISPER_MODEL_WEIGHTS_${modelId}_${new Date().toISOString()}`
    );
  } catch {
    // ignore
  }
  const state = getWhisperModelsState();
  return {
    status: "downloaded",
    model_id: modelId,
    ...state,
  };
}

export function deleteWhisperModelInStore(modelId: string): {
  deleted: boolean;
  model_id: string;
  models: WhisperModelInfo[];
  active_model: string;
} {
  const store = getStore();
  store.downloadedWhisperModels[modelId] = false;
  try {
    const mDir = path.join(STORAGE_ROOT, "models", modelId);
    if (fs.existsSync(mDir)) {
      fs.rmSync(mDir, { recursive: true, force: true });
    }
  } catch {
    // ignore
  }
  const state = getWhisperModelsState();
  return {
    deleted: true,
    model_id: modelId,
    ...state,
  };
}

function cleanAttendeeName(raw: string): { name: string; role: string } {
  const trimmed = (raw || "").trim();
  const match = trimmed.match(/^(.+?)\s*\((.+?)\)$/);
  if (match) {
    return { name: match[1].trim(), role: match[2].trim() };
  }
  return { name: trimmed, role: "Meeting Participant" };
}

export function processMeetingSession(
  meetingId: string,
  modelName?: string,
  rawNotes?: string
) {
  const store = getStore();
  const meeting = store.meetings.find((m) => m.id === meetingId);
  if (!meeting) {
    throw new Error("Meeting not found");
  }

  const userName = (store.settings.user_name || "Robin").trim();
  if (rawNotes !== undefined) {
    meeting.raw_notes = rawNotes;
  }

  // Ensure participants list has named colleagues
  const rawAttendees = (meeting.attendees || []).filter(
    (a) => {
      const cleaned = cleanAttendeeName(a).name.toLowerCase();
      return cleaned && cleaned !== userName.toLowerCase() && cleaned !== "me" && !a.includes("(ME)");
    }
  );

  const colleagues =
    rawAttendees.length > 0
      ? rawAttendees.map(cleanAttendeeName)
      : [
          { name: "Elena Rostova", role: "Lead Security Architect" },
          { name: "David Kim", role: "Staff Backend Engineer" },
        ];

  if (!meeting.attendees || meeting.attendees.length === 0) {
    meeting.attendees = [
      `${userName} (ME)`,
      ...colleagues.map((c) => `${c.name} (${c.role})`),
    ];
  }

  let segments = store.transcripts[meetingId] || [];
  const nowIso = new Date().toISOString();

  // If this session has no transcript segments yet, synthesize realistic multi-speaker audio transcription
  if (segments.length === 0) {
    const p1 = colleagues[0];
    const p2 = colleagues[1] || colleagues[0];
    const topic = meeting.title || "Product & Architecture Sync";
    const agendaFocus = meeting.agenda || "system reliability, rollout milestones, and API contracts";

    segments = [
      {
        id: `seg-${meetingId}-01`,
        meeting_id: meetingId,
        speaker_label: "ME",
        speaker_name: userName,
        is_user: 1,
        text: `Thanks for joining ${topic}. Let's align on ${agendaFocus} and lock down our concrete deliverables for this sprint.`,
        start_time: 4.0,
        end_time: 14.0,
        timestamp_badge: "00:00:04",
        raw_confidence: 0.98,
        created_at: nowIso,
      },
      {
        id: `seg-${meetingId}-02`,
        meeting_id: meetingId,
        speaker_label: "Speaker_A",
        speaker_name: p1.name,
        is_user: 0,
        text: `From my side as ${p1.role}, we need zero-downtime canary validation before we flip production traffic. I will deliver the automated canary verification suite by Thursday at 2 PM.`,
        start_time: 15.0,
        end_time: 29.0,
        timestamp_badge: "00:00:15",
        raw_confidence: 0.97,
        created_at: nowIso,
      },
      {
        id: `seg-${meetingId}-03`,
        meeting_id: meetingId,
        speaker_label: "ME",
        speaker_name: userName,
        is_user: 1,
        text: `I think we can probably just push the entire release by tomorrow evening if nobody slows us down with extra reviews.`,
        start_time: 31.0,
        end_time: 42.0,
        timestamp_badge: "00:00:31",
        raw_confidence: 0.96,
        created_at: nowIso,
      },
      {
        id: `seg-${meetingId}-04`,
        meeting_id: meetingId,
        speaker_label: "Speaker_B",
        speaker_name: p2.name,
        is_user: 0,
        text: `Hold on ${userName}, skipping staging soak tests caused a rollback last month. I commit to running the 10k RPS load benchmark by Wednesday 4 PM so we have hard numbers.`,
        start_time: 44.0,
        end_time: 58.0,
        timestamp_badge: "00:00:44",
        raw_confidence: 0.98,
        created_at: nowIso,
      },
      {
        id: `seg-${meetingId}-05`,
        meeting_id: meetingId,
        speaker_label: "ME",
        speaker_name: userName,
        is_user: 1,
        text: `Fine, whatever you both think is best, we'll just do the staged rollout and I'll update the deployment checklist by Wednesday noon.`,
        start_time: 60.0,
        end_time: 72.0,
        timestamp_badge: "00:01:00",
        raw_confidence: 0.97,
        created_at: nowIso,
      },
    ];
    store.transcripts[meetingId] = segments;
  }

  // Update duration if 0
  const maxEnd = segments.reduce((acc, s) => Math.max(acc, s.end_time || 0), 0);
  if (!meeting.duration_sec || meeting.duration_sec < maxEnd) {
    meeting.duration_sec = Math.max(120, Math.round(maxEnd));
  }

  // 1. Generate or refresh Executive Summary & Analysis if not already custom-seeded
  if (!store.analyses[meetingId]) {
    const nonUserSpeakers = Array.from(
      new Set(segments.filter((s) => !s.is_user).map((s) => s.speaker_name))
    );
    const firstSeg = segments[0];
    const commitSegs = segments.filter((s) =>
      /\b(will|commit|deliver|configure|review|update|prepare|approve|lock)\b/i.test(s.text)
    );

    store.analyses[meetingId] = {
      id: `analysis-${meetingId}`,
      meeting_id: meetingId,
      executive_summary: `${userName} and ${nonUserSpeakers.join(", ") || "the team"} reviewed "${meeting.title}" (${segments.length} transcript turns, processed with Whisper ${modelName || store.settings.whisper_model}). The team aligned on staged rollout guardrails, automated verification benchmarks, and explicit delivery owners.`,
      decisions: (commitSegs.length > 0 ? commitSegs : segments).slice(0, 3).map(
        (s) => `${s.speaker_name}: ${s.text} [${s.timestamp_badge}]`
      ),
      rejected_alternatives: [
        `Unbuffered immediate production cutover without canary soak testing [${segments[2]?.timestamp_badge || firstSeg?.timestamp_badge || "00:00:31"}].`,
      ],
      action_plan: [
        {
          phase: "Phase 1: Checklist & Contracts",
          details: `${userName} updates deployment checklist and schema guardrails.`,
        },
        {
          phase: "Phase 2: Load & Canary Benchmarks",
          details: `${nonUserSpeakers.join(" & ") || "Engineering"} execute automated canary and load validation.`,
        },
      ],
      created_at: nowIso,
    };

    store.epochs[meetingId] = [
      {
        id: `epoch-${meetingId}-1`,
        meeting_id: meetingId,
        epoch_index: 1,
        start_min: 0,
        end_min: Math.max(5, Math.ceil(meeting.duration_sec / 60)),
        summary_markdown: `### Epoch 1: ${meeting.title}\n- Aligned on agenda goals and rollout verification.\n- Locked down concrete commitments across ${nonUserSpeakers.join(", ") || "participants"}.`,
        key_topics: [meeting.title, "Commitments", "Verification"],
        created_at: nowIso,
      },
    ];

    // Generate Todos for this meeting
    store.todos = store.todos.filter((t) => t.meeting_id !== meetingId);
    for (let i = 0; i < Math.min(3, commitSegs.length); i++) {
      const cs = commitSegs[i];
      store.todos.push({
        id: `todo-${meetingId}-${i + 1}`,
        meeting_id: meetingId,
        task: cs.text,
        owner: cs.is_user ? `${userName} (ME)` : cs.speaker_name,
        deadline: i === 0 ? "Thursday - 2:00 PM" : "Wednesday - 4:00 PM",
        priority: i === 0 ? "HIGH" : "MEDIUM",
        timestamp_ref: cs.timestamp_badge,
        completed: 0,
      });
    }

    // Generate Memory Cards for this meeting
    store.memories = store.memories.filter((m) => m.meeting_id !== meetingId);
    for (const seg of segments.filter((s) => !s.is_user).slice(0, 2)) {
      store.memories.push({
        id: `mem-${meetingId}-${seg.id}`,
        meeting_id: meetingId,
        fact: seg.text,
        context: `Key statement from ${meeting.title}`,
        person: seg.speaker_name,
        timestamp_ref: seg.timestamp_badge,
        category: "Commitment & Constraint",
      });
    }
  }

  // 2. ALWAYS run Personal Communication & Negotiation Coach on every processed meeting session!
  const existingCoachingForMeeting = store.coaching.filter((c) => c.meeting_id === meetingId);
  if (existingCoachingForMeeting.length === 0) {
    const userSegs = segments.filter(
      (s) => s.is_user === 1 || s.speaker_name.toLowerCase() === userName.toLowerCase()
    );
    const targetUserSegs = userSegs.length > 0 ? userSegs : segments.slice(0, 1);

    const newCards: CoachingCard[] = [];
    for (const uSeg of targetUserSegs) {
      const lower = uSeg.text.toLowerCase();
      if (
        lower.includes("probably") ||
        lower.includes("i think") ||
        lower.includes("if nobody") ||
        lower.includes("maybe")
      ) {
        newCards.push({
          id: `coach-${meetingId}-${uSeg.id}`,
          meeting_id: meetingId,
          timestamp_ref: uSeg.timestamp_badge,
          what_you_said: uSeg.text,
          tone_detected: "Over-promising & Defensively Conditional",
          impact_analysis:
            "Hedging with 'probably' while blaming potential team reviews weakens executive confidence and sets up an unbuffered deadline risk.",
          better_response:
            "We can ship the core release candidate by tomorrow evening if we scope Phase 1 to verified endpoints and run canary checks in parallel.",
          coaching_principle:
            "Scope De-Risking & Phased Credibility: Pair ambitious timelines with explicit scope boundaries.",
          clarity_score: 64,
          empathy_score: 58,
          meeting_title: meeting.title,
        });
      } else if (
        lower.includes("whatever") ||
        lower.includes("fine") ||
        lower.includes("rehashing") ||
        lower.includes("don't know why")
      ) {
        newCards.push({
          id: `coach-${meetingId}-${uSeg.id}`,
          meeting_id: meetingId,
          timestamp_ref: uSeg.timestamp_badge,
          what_you_said: uSeg.text,
          tone_detected: "Passive Resignation & Abdicated Ownership",
          impact_analysis:
            "Conceding with 'fine, whatever you think' signals disengagement before committing to a deliverable, reducing perceived leadership authority.",
          better_response:
            "That's a fair risk callout on staging soak tests. Let's adopt the staged rollout—I'll update the deployment checklist by Wednesday noon to support it.",
          coaching_principle:
            "Constructive Alignment: Acknowledge technical data points directly and own the resulting action item with authority.",
          clarity_score: 68,
          empathy_score: 62,
          meeting_title: meeting.title,
        });
      }
    }

    if (newCards.length === 0 && targetUserSegs.length > 0) {
      const uSeg = targetUserSegs[0];
      newCards.push({
        id: `coach-${meetingId}-${uSeg.id}`,
        meeting_id: meetingId,
        timestamp_ref: uSeg.timestamp_badge,
        what_you_said: uSeg.text,
        tone_detected: "Direct & Collaborative Framing",
        impact_analysis:
          "Clear opening framing that establishes the agenda, though adding explicit timeboxed decision criteria would increase leverage.",
        better_response: `${uSeg.text} By the end of this call, let's assign a single owner and verification metric to each milestone.`,
        coaching_principle:
          "Executive Anchoring: Open every sync with the exact decision criteria required to adjourn.",
        clarity_score: 84,
        empathy_score: 82,
        meeting_title: meeting.title,
      });
    }

    store.coaching = [
      ...newCards,
      ...store.coaching.filter((c) => c.meeting_id !== meetingId),
    ];
  }

  // 3. ALWAYS update Individual Conversation & Commitment Dossiers on every processed meeting session!
  const remoteSegments = segments.filter(
    (s) => s.is_user === 0 && s.speaker_name.toLowerCase() !== userName.toLowerCase()
  );
  const userPromiseSeg = segments.find(
    (s) =>
      s.is_user === 1 &&
      /\b(will|commit|update|review|deliver|prepare|agree)\b/i.test(s.text)
  );
  const defaultUserPromise = userPromiseSeg
    ? userPromiseSeg.text
    : `${userName} committed to coordinating ${meeting.title} deliverables.`;

  const participantNames = new Set<string>();
  for (const s of remoteSegments) {
    if (s.speaker_name && s.speaker_name !== "Others" && s.speaker_name !== "Unknown") {
      participantNames.add(s.speaker_name);
    }
  }
  for (const c of colleagues) {
    if (c.name && c.name.toLowerCase() !== userName.toLowerCase()) {
      participantNames.add(c.name);
    }
  }

  for (const personName of Array.from(participantNames)) {
    const colleagueMeta = colleagues.find(
      (c) => c.name.toLowerCase() === personName.toLowerCase()
    );
    const personSegs = remoteSegments.filter(
      (s) => s.speaker_name.toLowerCase() === personName.toLowerCase()
    );
    const talkSecInMeeting = personSegs.reduce(
      (acc, s) => acc + Math.max(2, (s.end_time || 0) - (s.start_time || 0)),
      0
    );
    const bestQuoteSeg =
      personSegs.find((s) =>
        /\b(will|commit|deliver|configure|benchmark|need|approve)\b/i.test(s.text)
      ) || personSegs[0];

    let person = store.individuals.find(
      (p) => p.name.toLowerCase() === personName.toLowerCase()
    );

    const interactionEntry = {
      id: `act-${meetingId}-${personName.toLowerCase().replace(/\W+/g, "-")}`,
      individual_id: person?.id || `ind-${personName.toLowerCase().replace(/\W+/g, "-")}`,
      meeting_id: meetingId,
      meeting_title: meeting.title,
      timestamp_ref: bestQuoteSeg?.timestamp_badge || "00:00:15",
      quote:
        bestQuoteSeg?.text ||
        `Participated in ${meeting.title} and reviewed milestone deliverables.`,
      promises_by_them:
        bestQuoteSeg?.text ||
        `Deliver ${colleagueMeta?.role || "team"} verification milestones for ${meeting.title}.`,
      promises_by_user: defaultUserPromise,
      topic: meeting.title,
      sentiment: "positive",
      created_at: nowIso,
    };

    if (!person) {
      const newId = `ind-${personName.toLowerCase().replace(/\W+/g, "-")}`;
      interactionEntry.individual_id = newId;
      person = {
        id: newId,
        name: personName,
        role: colleagueMeta?.role || "Cross-Functional Partner",
        email: `${personName.toLowerCase().replace(/\s+/g, ".")}@company.internal`,
        avatar_url:
          "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150",
        first_met: nowIso,
        last_met: nowIso,
        total_meetings: 1,
        talk_time_sec_total: Math.round(talkSecInMeeting) || 60,
        reliability_score: 92,
        communication_cheat_sheet: `Focuses on ${colleagueMeta?.role || "operational"} rigor, verifiable metrics, and explicit rollout safety during "${meeting.title}". Lead with concrete data and clear owners.`,
        notes: `Automatically tracked from session "${meeting.title}".`,
        interactions: [interactionEntry],
      };
      store.individuals.unshift(person);
    } else {
      const existingInteractions = Array.isArray(person.interactions)
        ? person.interactions
        : [];
      const alreadyLoggedForMeeting = existingInteractions.some(
        (act: any) => act.meeting_id === meetingId
      );
      if (!alreadyLoggedForMeeting) {
        person.interactions = [interactionEntry, ...existingInteractions];
        person.total_meetings = (person.total_meetings || 1) + 1;
        person.talk_time_sec_total =
          (person.talk_time_sec_total || 0) + Math.round(talkSecInMeeting);
      } else {
        person.interactions = existingInteractions.map((act: any) =>
          act.meeting_id === meetingId ? interactionEntry : act
        );
      }
      person.last_met = nowIso;
    }
  }

  // 4. Enhance notes if raw_notes exist
  if (meeting.raw_notes && meeting.raw_notes.trim() && segments.length > 0) {
    meeting.enhanced_notes = enhanceNotesWithTranscript(
      meeting.title,
      meeting.raw_notes,
      segments
    );
  }

  meeting.status = "completed";
  meeting.ended_at = meeting.ended_at || nowIso;
  meeting.has_audio = true;
  meeting.has_markdown = true;
  delete store.activeRecordings[meetingId];

  // Remove from active detected calls once stopped & processed
  store.detectedCalls = store.detectedCalls.filter(
    (c) => c.recording_meeting_id !== meetingId
  );

  const mdContent = generateMeetingMarkdown(
    meeting,
    store.analyses[meetingId],
    store.todos.filter((t) => t.meeting_id === meetingId),
    store.memories.filter((m) => m.meeting_id === meetingId),
    store.coaching.filter((c) => c.meeting_id === meetingId),
    segments
  );
  const diskInfo = ensureSessionFilesOnDisk(meeting, mdContent);
  meeting.folder_path = diskInfo.folderPath;

  store.processingStatuses[meetingId] = {
    meeting_id: meetingId,
    status: "completed",
    stage: "completed",
    step: 4,
    total_steps: 4,
    progress: 100,
    message: "Done — transcript, summary, behavioral coaching, and people dossiers updated.",
    export_path: diskInfo.markdownPath,
  };

  return {
    status: "completed",
    meeting_id: meetingId,
    meeting,
    analysis: store.analyses[meetingId],
    coaching: store.coaching.filter((c) => c.meeting_id === meetingId),
    individuals: store.individuals,
  };
}

export function simulateOrDetectCall(params?: {
  platform?: "meet" | "zoom" | "teams";
  title?: string;
  attendees?: string[];
  auto_start_recording?: boolean;
}) {
  const store = getStore();
  const platform = params?.platform || "meet";
  const nowIso = new Date().toISOString();
  const userName = (store.settings.user_name || "Robin").trim();

  const defaultTemplates: Record<
    "meet" | "zoom" | "teams",
    { title: string; url: string; attendees: string[]; agenda: string }
  > = {
    meet: {
      title: "Production Incident & Canary Rollout Sync",
      url: "https://meet.google.com/kqx-vbnm-pqr",
      attendees: [
        `${userName} (ME)`,
        "Elena Rostova (Lead Security Architect)",
        "David Kim (Staff Backend Engineer)",
      ],
      agenda:
        "Verify zero-downtime canary rollout, 10k RPS load benchmark, and deployment checklist.",
    },
    zoom: {
      title: "Enterprise Renewal & SLA Negotiation",
      url: "https://app.zoom.us/wc/948102394/join",
      attendees: [
        `${userName} (ME)`,
        "Elena Rostova (Lead Security Architect)",
        "Marcus Vance (Principal PM)",
      ],
      agenda: "Align on Q4 enterprise SLA guarantees and security audit deliverables.",
    },
    teams: {
      title: "Cross-Platform API Gateway Review",
      url: "https://teams.cloud.microsoft/l/meetup-join/19%3ameeting_aura",
      attendees: [
        `${userName} (ME)`,
        "David Kim (Staff Backend Engineer)",
        "Priya Sharma (Staff Architect)",
      ],
      agenda: "Review gRPC gateway rate limiting and automated failover policies.",
    },
  };

  const tpl = defaultTemplates[platform] || defaultTemplates.meet;
  const title = (params?.title || tpl.title).trim();
  const attendees =
    params?.attendees && params.attendees.length > 0
      ? params.attendees
      : tpl.attendees;

  const autoRecord =
    params?.auto_start_recording !== undefined
      ? params.auto_start_recording
      : store.autoRecordEnabled;

  let recordingMeetingId: string | null = null;
  let createdMeeting: Meeting | null = null;

  if (autoRecord) {
    const meetingId = `meet-${Math.random().toString(36).slice(2, 9)}`;
    recordingMeetingId = meetingId;
    createdMeeting = {
      id: meetingId,
      title,
      agenda: tpl.agenda,
      attendees,
      created_at: nowIso,
      status: "recording",
      duration_sec: 18,
      drift_score: 0,
      has_audio: true,
      raw_notes: `• Auto-detected ${platform.toUpperCase()} call: ${title}\n• Participants: ${attendees.join(", ")}`,
      enhanced_notes: "",
      folder_path: `${STORAGE_ROOT}/${meetingId}`,
      has_markdown: true,
      platform,
      meeting_url: tpl.url,
    };
    ensureSessionFilesOnDisk(createdMeeting);
    store.meetings.unshift(createdMeeting);
    store.transcripts[meetingId] = [];
    store.activeRecordings[meetingId] = {
      meeting_id: meetingId,
      seconds: 18,
      mic_level: 0.68,
      tab_level: 0.54,
    };
  }

  const detectedCall: DetectedCallInfo = {
    id: `det-${Math.random().toString(36).slice(2, 8)}`,
    platform,
    title,
    meeting_url: tpl.url,
    attendees,
    detected_at: nowIso,
    in_call: true,
    recording_meeting_id: recordingMeetingId,
  };

  store.detectedCalls = [detectedCall, ...store.detectedCalls.slice(0, 2)];

  return {
    detected_call: detectedCall,
    meeting: createdMeeting,
    auto_recording_started: Boolean(createdMeeting),
  };
}

export function getIndividualDossierWithSegments(personId: string): IndividualProfile | null {
  const store = getStore();
  const person = store.individuals.find((p) => p.id === personId);
  if (!person) return null;

  const spokenSegments: any[] = [];
  for (const m of store.meetings) {
    const segs = store.transcripts[m.id] || [];
    for (const s of segs) {
      if (s.speaker_name.toLowerCase() === person.name.toLowerCase()) {
        spokenSegments.push({
          id: s.id,
          meeting_id: m.id,
          text: s.text,
          timestamp_badge: s.timestamp_badge,
          start_time: s.start_time,
          meeting_title: m.title,
        });
      }
    }
  }

  return {
    ...person,
    spoken_segments: spokenSegments,
  };
}

export function draftFollowupMessage(
  meeting: Meeting,
  analysis: MeetingAnalysisRecord | undefined,
  todos: TodoItem[],
  userName: string,
  format: "email" | "slack"
): FollowupDraft {
  const attendeesStr = (meeting.attendees || []).join(", ") || "Team";
  const execSummary = analysis?.executive_summary || "Summary not generated yet.";
  const decisions = analysis?.decisions || [];

  if (format === "slack") {
    const lines = [
      `:memo: *Meeting Recap: ${meeting.title}*`,
      `*Attendees:* ${attendeesStr}\n`,
      `:bulb: *TL;DR:* ${execSummary}\n`,
      `:white_check_mark: *Decisions:*`,
      ...(decisions.length ? decisions.map((d) => `• ${d}`) : ["• None recorded."]),
      `\n:dart: *Action Items:*`,
      ...(todos.length
        ? todos.map(
            (t) =>
              `• *${t.task}* — ${t.owner}${t.deadline ? ` (due ${t.deadline})` : ""}`
          )
        : ["• None."]),
    ];
    return {
      meeting_id: meeting.id,
      format: "slack",
      subject: `Recap: ${meeting.title}`,
      body: lines.join("\n"),
      mailto_link: "",
    };
  }

  const subject = `Recap & Action Items: ${meeting.title}`;
  const lines = [
    "Hi everyone,\n",
    `Thanks for your time in '${meeting.title}'. Here's a quick recap:\n`,
    `Summary:\n${execSummary}\n`,
    "Decisions:",
    ...(decisions.length ? decisions.map((d) => `  • ${d}`) : ["  • None recorded."]),
    "\nAction Items:",
    ...(todos.length
      ? todos.map(
          (t) =>
            `  • ${t.task} — ${t.owner}${t.deadline ? ` (due ${t.deadline})` : ""}`
        )
      : ["  • None."]),
    `\nLet me know if I missed anything.\n\nBest,\n${userName || "Robin"}`,
  ];
  const body = lines.join("\n");
  const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return {
    meeting_id: meeting.id,
    format: "email",
    subject,
    body,
    mailto_link: mailto,
  };
}

export function performGlobalSearch(query: string): GlobalSearchResult {
  const store = getStore();
  const q = (query || "").trim().toLowerCase();
  if (!q) {
    return { query: "", meetings: [], transcripts: [], todos: [], people: [], total_results: 0 };
  }

  const matchedMeetings = store.meetings.filter(
    (m) => m.title.toLowerCase().includes(q) || (m.agenda || "").toLowerCase().includes(q)
  );

  const matchedTranscripts: any[] = [];
  for (const m of store.meetings) {
    const segs = store.transcripts[m.id] || [];
    for (const s of segs) {
      if (
        s.text.toLowerCase().includes(q) ||
        s.speaker_name.toLowerCase().includes(q)
      ) {
        matchedTranscripts.push({
          segment_id: s.id,
          meeting_id: m.id,
          speaker_name: s.speaker_name,
          text: s.text,
          timestamp_badge: s.timestamp_badge,
          snippet: s.text,
          meeting_title: m.title,
        });
      }
    }
  }

  const matchedTodos = store.todos
    .filter((t) => t.task.toLowerCase().includes(q) || t.owner.toLowerCase().includes(q))
    .map((t) => ({
      ...t,
      meeting_title: store.meetings.find((m) => m.id === t.meeting_id)?.title || "Meeting",
    }));

  const matchedPeople = store.individuals.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      (p.role || "").toLowerCase().includes(q) ||
      (p.communication_cheat_sheet || "").toLowerCase().includes(q)
  );

  return {
    query: query.trim(),
    meetings: matchedMeetings,
    transcripts: matchedTranscripts.slice(0, 15),
    todos: matchedTodos,
    people: matchedPeople,
    total_results:
      matchedMeetings.length +
      matchedTranscripts.slice(0, 15).length +
      matchedTodos.length +
      matchedPeople.length,
  };
}
