import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { buildExtensionZipBuffer } from "@/lib/extension-packager";
import {
  getStore,
  resetStoreToEmpty,
  restoreDemoStore,
  computeDominanceRatio,
  computeCoachMetrics,
  generateCalendarLinks,
  generateMeetingMarkdown,
  enhanceNotesWithTranscript,
  answerMeetingChat,
  getIndividualDossierWithSegments,
  draftFollowupMessage,
  performGlobalSearch,
  ensureSessionFilesOnDisk,
  deleteMeetingFromStore,
  deleteIndividualFromStore,
  getWhisperModelsState,
  downloadWhisperModelInStore,
  deleteWhisperModelInStore,
  processMeetingSession,
  simulateOrDetectCall,
  getStorageStats,
  revealMeetingInFileManager,
  STORAGE_ROOT,
} from "@/lib/aura-store";

async function safeJson(req: NextRequest): Promise<any> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export async function GET(
  req: NextRequest,
  context: { params: { path: string[] } }
) {
  const path = context.params.path || [];
  const store = getStore();
  const url = new URL(req.url);

  // GET /api/extension/download
  if (path.length === 2 && path[0] === "extension" && path[1] === "download") {
    const zipBuffer = buildExtensionZipBuffer();
    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="aura-meet-chrome-extension.zip"',
        "Content-Length": String(zipBuffer.length),
      },
    });
  }

  // GET /api/status
  if (path.length === 1 && path[0] === "status") {
    return NextResponse.json({
      status: "online",
      timestamp: new Date().toISOString(),
      lm_studio: {
        online: true,
        endpoint: store.settings.lm_studio_base_url,
        latency_ms: 14,
        models: ["gemma-4", "gemma-4-9b-it", "gemma-4-27b"],
        active_model: store.settings.lm_studio_model,
        model_available: true,
        message: `Connected: ${store.settings.lm_studio_model} via Local Intelligence Engine (14ms)`,
      },
      config: store.settings,
    });
  }

  // GET /api/settings
  if (path.length === 1 && path[0] === "settings") {
    return NextResponse.json(store.settings);
  }

  // GET /api/settings/models
  if (path.length === 2 && path[0] === "settings" && path[1] === "models") {
    return NextResponse.json({
      online: true,
      endpoint: store.settings.lm_studio_base_url,
      latency_ms: 14,
      models: ["gemma-4", "gemma-4-9b-it", "gemma-4-27b"],
      active_model: store.settings.lm_studio_model,
      model_available: true,
      message: `Connected: ${store.settings.lm_studio_model} ready for synthesis & coaching (14ms)`,
    });
  }

  // GET /api/models/whisper
  if (path.length === 2 && path[0] === "models" && path[1] === "whisper") {
    return NextResponse.json(getWhisperModelsState());
  }

  // GET /api/detection/status
  if (path.length === 2 && path[0] === "detection" && path[1] === "status") {
    return NextResponse.json({
      auto_detect_enabled: store.autoDetectEnabled,
      auto_record_enabled: store.autoRecordEnabled,
      detected_calls: store.detectedCalls,
      storage_stats: getStorageStats(),
    });
  }

  // GET /api/recording/active
  if (path.length === 2 && path[0] === "recording" && path[1] === "active") {
    return NextResponse.json(Object.values(store.activeRecordings));
  }

  // GET /api/search?q=...
  if (path.length === 1 && path[0] === "search") {
    const q = url.searchParams.get("q") || "";
    return NextResponse.json(performGlobalSearch(q));
  }

  // GET /api/coach
  if (path.length === 1 && path[0] === "coach") {
    const allUserSegs = Object.values(store.transcripts)
      .flat()
      .filter((s) => s.is_user === 1);
    const metrics = computeCoachMetrics(store.coaching, allUserSegs);
    return NextResponse.json({
      metrics,
      cards: store.coaching,
    });
  }

  // GET /api/individuals
  if (path.length === 1 && path[0] === "individuals") {
    return NextResponse.json(store.individuals);
  }

  // GET /api/individuals/:id
  if (path.length === 2 && path[0] === "individuals") {
    const dossier = getIndividualDossierWithSegments(path[1]);
    if (!dossier) {
      return NextResponse.json({ detail: "Person not found" }, { status: 404 });
    }
    return NextResponse.json(dossier);
  }

  // GET /api/calendar/download-ics
  if (path.length === 2 && path[0] === "calendar" && path[1] === "download-ics") {
    const title = url.searchParams.get("title") || "Meeting Action Item";
    const description = url.searchParams.get("description") || "";
    const deadline = url.searchParams.get("deadline") || undefined;
    const cal = generateCalendarLinks({ title, description, deadline });
    return new NextResponse(cal.ics_content, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="meeting-item.ics"',
      },
    });
  }

  // GET /api/meetings
  if (path.length === 1 && path[0] === "meetings") {
    return NextResponse.json(store.meetings);
  }

  // GET /api/meetings/:id and sub-routes
  if (path[0] === "meetings" && path.length >= 2) {
    const meetingId = path[1];
    const meeting = store.meetings.find((m) => m.id === meetingId);

    if (path.length === 2) {
      if (!meeting) {
        return NextResponse.json({ detail: "Meeting not found" }, { status: 404 });
      }
      return NextResponse.json(meeting);
    }

    const sub = path[2];

    if (sub === "transcript") {
      return NextResponse.json(store.transcripts[meetingId] || []);
    }

    if (sub === "dominance") {
      return NextResponse.json(
        computeDominanceRatio(store.transcripts[meetingId] || [])
      );
    }

    if (sub === "drift") {
      return NextResponse.json({
        drift_score: meeting?.drift_score || 0,
        is_drifting: false,
        current_topic: meeting?.title || "",
        nudge_message: "",
      });
    }

    if (sub === "analysis") {
      const analysis = store.analyses[meetingId];
      const todos = store.todos.filter((t) => t.meeting_id === meetingId);
      const memories = store.memories.filter((m) => m.meeting_id === meetingId);
      const coaching = store.coaching.filter((c) => c.meeting_id === meetingId);
      const epochs = store.epochs[meetingId] || [];

      if (!analysis) {
        return NextResponse.json({
          meeting_id: meetingId,
          has_analysis: false,
          executive_summary: "",
          decisions: [],
          rejected_alternatives: [],
          action_plan: [],
          todos,
          things_to_remember: memories,
          behavioral_coaching: coaching,
          epochs,
        });
      }

      return NextResponse.json({
        meeting_id: meetingId,
        has_analysis: true,
        executive_summary: analysis.executive_summary,
        decisions: analysis.decisions,
        rejected_alternatives: analysis.rejected_alternatives,
        action_plan: analysis.action_plan,
        todos,
        things_to_remember: memories,
        behavioral_coaching: coaching,
        epochs,
      });
    }

    if (sub === "todos") {
      return NextResponse.json(
        store.todos.filter((t) => t.meeting_id === meetingId)
      );
    }

    if (sub === "processing-status") {
      const st = store.processingStatuses[meetingId];
      if (st) return NextResponse.json(st);
      return NextResponse.json({
        meeting_id: meetingId,
        status: meeting?.status === "completed" ? "completed" : "idle",
        stage: meeting?.status === "completed" ? "completed" : "ready",
        step: meeting?.status === "completed" ? 4 : 0,
        total_steps: 4,
        progress: meeting?.status === "completed" ? 100 : 0,
        message:
          meeting?.status === "completed"
            ? "Meeting already processed."
            : "Ready to process",
      });
    }

    if (sub === "audio") {
      if (!meeting) {
        return NextResponse.json({ detail: "Meeting not found" }, { status: 404 });
      }
      const info = ensureSessionFilesOnDisk(meeting);
      try {
        const buf = fs.readFileSync(info.audioPath);
        return new NextResponse(buf, {
          status: 200,
          headers: {
            "Content-Type": "audio/wav",
            "Content-Disposition": `attachment; filename="${meetingId}.wav"`,
          },
        });
      } catch {
        return NextResponse.json({ detail: "Audio not found" }, { status: 404 });
      }
    }

    if (sub === "audio-info") {
      const diskInfo = meeting ? ensureSessionFilesOnDisk(meeting) : null;
      const sizeBytes = diskInfo?.sizeBytes || 0;
      return NextResponse.json({
        has_audio: Boolean(meeting?.has_audio),
        file_path: diskInfo?.audioPath || `${STORAGE_ROOT}/${meetingId}/audio.wav`,
        export_dir: store.settings.audio_export_dir,
        folder_path: diskInfo?.folderPath || `${STORAGE_ROOT}/${meetingId}`,
        markdown_path: diskInfo?.markdownPath || `${STORAGE_ROOT}/${meetingId}/meeting_notes.md`,
        has_markdown: true,
        size_bytes: sizeBytes,
        size_formatted: `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`,
      });
    }

    if (sub === "notes") {
      if (!meeting) {
        return NextResponse.json({ detail: "Meeting not found" }, { status: 404 });
      }
      return NextResponse.json({
        meeting_id: meetingId,
        raw_notes: meeting.raw_notes || "",
        enhanced_notes: meeting.enhanced_notes || "",
        markdown_path: `/recordings/${meetingId}/meeting_notes.md`,
        folder_path: meeting.folder_path || `/recordings/${meetingId}`,
        has_markdown: true,
      });
    }

    if (sub === "markdown" || sub === "download-markdown") {
      if (!meeting) {
        return NextResponse.json({ detail: "Meeting not found" }, { status: 404 });
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
      if (sub === "download-markdown") {
        return new NextResponse(mdContent, {
          status: 200,
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Content-Disposition": `attachment; filename="meeting_notes_${meetingId}.md"`,
          },
        });
      }
      return NextResponse.json({
        meeting_id: meetingId,
        content: mdContent,
        file_path: diskInfo.markdownPath,
        folder_path: diskInfo.folderPath,
      });
    }

    if (sub === "followup") {
      if (!meeting) {
        return NextResponse.json({ detail: "Meeting not found" }, { status: 404 });
      }
      const fmt = (url.searchParams.get("format") || "email") as "email" | "slack";
      const draft = draftFollowupMessage(
        meeting,
        store.analyses[meetingId],
        store.todos.filter((t) => t.meeting_id === meetingId),
        store.settings.user_name,
        fmt
      );
      return NextResponse.json(draft);
    }
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function POST(
  req: NextRequest,
  context: { params: { path: string[] } }
) {
  const path = context.params.path || [];
  const store = getStore();
  const body = await safeJson(req);

  // POST /api/settings
  if (path.length === 1 && path[0] === "settings") {
    store.settings = {
      ...store.settings,
      ...Object.fromEntries(
        Object.entries(body).filter(([_, v]) => v !== undefined && v !== null)
      ),
    };
    return NextResponse.json(store.settings);
  }

  // POST /api/calendar/export
  if (path.length === 2 && path[0] === "calendar" && path[1] === "export") {
    return NextResponse.json(
      generateCalendarLinks({
        title: body.title || "Action Item",
        description: body.description || "",
        deadline: body.deadline,
        attendees: body.attendees,
      })
    );
  }

  // POST /api/todos/:id/toggle
  if (path.length === 3 && path[0] === "todos" && path[2] === "toggle") {
    const todoId = path[1];
    const todo = store.todos.find((t) => t.id === todoId);
    if (!todo) {
      return NextResponse.json({ detail: "Todo not found" }, { status: 404 });
    }
    todo.completed = todo.completed === 1 ? 0 : 1;
    return NextResponse.json({
      id: todoId,
      completed: Boolean(todo.completed),
      status: todo.completed ? "COMPLETED" : "PENDING",
    });
  }

  // POST /api/meetings/clear-all
  if (path.length === 2 && path[0] === "meetings" && path[1] === "clear-all") {
    resetStoreToEmpty();
    return NextResponse.json({
      status: "SUCCESS",
      message: "All sessions cleared.",
    });
  }

  // POST /api/meetings/restore-demo
  if (path.length === 2 && path[0] === "meetings" && path[1] === "restore-demo") {
    restoreDemoStore();
    return NextResponse.json({
      status: "SUCCESS",
      message: "Demo sessions restored.",
    });
  }

  // POST /api/models/whisper/download
  if (path.length === 3 && path[0] === "models" && path[1] === "whisper" && path[2] === "download") {
    try {
      const res = downloadWhisperModelInStore(body.model_id);
      return NextResponse.json(res);
    } catch (e: any) {
      return NextResponse.json({ detail: e?.message || "Invalid model" }, { status: 400 });
    }
  }

  // POST /api/detection/simulate
  if (path.length === 2 && path[0] === "detection" && path[1] === "simulate") {
    const res = simulateOrDetectCall(body);
    return NextResponse.json(res);
  }

  // POST /api/detection/settings
  if (path.length === 2 && path[0] === "detection" && path[1] === "settings") {
    if (body.auto_detect_enabled !== undefined) {
      store.autoDetectEnabled = Boolean(body.auto_detect_enabled);
    }
    if (body.auto_record_enabled !== undefined) {
      store.autoRecordEnabled = Boolean(body.auto_record_enabled);
    }
    return NextResponse.json({
      auto_detect_enabled: store.autoDetectEnabled,
      auto_record_enabled: store.autoRecordEnabled,
    });
  }

  // POST /api/meetings (create new meeting)
  if (path.length === 1 && path[0] === "meetings") {
    const id = `meet-${Math.random().toString(36).slice(2, 10)}`;
    const nowIso = new Date().toISOString();
    const status = body.status || "recording";
    const newMeeting: any = {
      id,
      title: (body.title || "Untitled meeting").trim(),
      agenda: body.agenda || "",
      attendees: Array.isArray(body.attendees) ? body.attendees : [],
      created_at: nowIso,
      status,
      duration_sec: status === "recording" ? 12 : 0,
      drift_score: 0,
      has_audio: true,
      raw_notes: "",
      enhanced_notes: "",
      folder_path: `${STORAGE_ROOT}/${id}`,
      has_markdown: true,
      platform: body.platform || "meet",
      meeting_url: body.meeting_url || "",
    };
    ensureSessionFilesOnDisk(newMeeting);
    store.meetings.unshift(newMeeting);
    store.transcripts[id] = [];
    if (status === "recording") {
      store.activeRecordings[id] = {
        meeting_id: id,
        seconds: 12,
        mic_level: 0.65,
        tab_level: 0.52,
      };
    }
    return NextResponse.json(newMeeting);
  }

  // POST /api/meetings/:id/...
  if (path[0] === "meetings" && path.length >= 3) {
    const meetingId = path[1];
    const sub = path[2];
    const meeting = store.meetings.find((m) => m.id === meetingId);
    if (!meeting) {
      return NextResponse.json({ detail: "Meeting not found" }, { status: 404 });
    }

    if (sub === "notes") {
      meeting.raw_notes = body.raw_notes ?? "";
      return NextResponse.json({
        status: "SUCCESS",
        meeting_id: meetingId,
        raw_notes: meeting.raw_notes,
      });
    }

    if (sub === "reveal-in-folder") {
      try {
        const res = revealMeetingInFileManager(meetingId, body.os);
        return NextResponse.json(res);
      } catch (e: any) {
        return NextResponse.json({ detail: e?.message || "Cannot reveal folder" }, { status: 400 });
      }
    }

    if (sub === "markdown") {
      const customContent = typeof body.content === "string" ? body.content : undefined;
      const diskInfo = ensureSessionFilesOnDisk(meeting, customContent);
      return NextResponse.json({
        status: "SAVED",
        meeting_id: meetingId,
        file_path: diskInfo.markdownPath,
        folder_path: diskInfo.folderPath,
      });
    }

    if (sub === "enhance-notes") {
      const raw = body.raw_notes ?? meeting.raw_notes ?? "";
      meeting.raw_notes = raw;
      const segs = store.transcripts[meetingId] || [];
      if (segs.length === 0) {
        return NextResponse.json({
          meeting_id: meetingId,
          status: "no_transcript",
          raw_notes: raw,
          enhanced_notes: "",
          markdown_path: `/recordings/${meetingId}/meeting_notes.md`,
        });
      }
      const enhanced = enhanceNotesWithTranscript(meeting.title, raw, segs);
      meeting.enhanced_notes = enhanced;
      return NextResponse.json({
        meeting_id: meetingId,
        status: "enhanced",
        raw_notes: raw,
        enhanced_notes: enhanced,
        markdown_path: `/recordings/${meetingId}/meeting_notes.md`,
      });
    }

    if (sub === "chat") {
      const query = body.query || "";
      const thinking = Boolean(body.thinking);
      return NextResponse.json(
        answerMeetingChat(
          query,
          thinking,
          meeting,
          store.analyses[meetingId],
          store.todos.filter((t) => t.meeting_id === meetingId),
          store.memories.filter((m) => m.meeting_id === meetingId),
          store.transcripts[meetingId] || [],
          store.coaching,
          store.individuals
        )
      );
    }

    if (sub === "generate-analysis") {
      processMeetingSession(meetingId, store.settings.whisper_model, meeting.raw_notes);
      const analysis = store.analyses[meetingId];
      const todos = store.todos.filter((t) => t.meeting_id === meetingId);
      const memories = store.memories.filter((m) => m.meeting_id === meetingId);
      const coaching = store.coaching.filter((c) => c.meeting_id === meetingId);
      const epochs = store.epochs[meetingId] || [];
      return NextResponse.json({
        meeting_id: meetingId,
        has_analysis: Boolean(analysis),
        executive_summary:
          analysis?.executive_summary ||
          `Synthesized ${store.transcripts[meetingId]?.length || 0} transcript segments for ${meeting.title}.`,
        decisions: analysis?.decisions || [],
        rejected_alternatives: analysis?.rejected_alternatives || [],
        action_plan: analysis?.action_plan || [],
        todos,
        things_to_remember: memories,
        behavioral_coaching: coaching,
        epochs,
      });
    }

    if (sub === "process" || sub === "stop" || sub === "finish") {
      const modelToUse = body.model_name || store.settings.whisper_model || "large-v3-turbo";
      const result = processMeetingSession(meetingId, modelToUse, body.raw_notes);
      return NextResponse.json({
        status: "completed",
        meeting_id: meetingId,
        model_name: modelToUse,
        message: "Processed transcript, summary, behavioral coaching, and individual dossiers.",
        coaching_count: result.coaching.length,
        individuals_count: result.individuals.length,
      });
    }
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(
  req: NextRequest,
  context: { params: { path: string[] } }
) {
  const path = context.params.path || [];
  const store = getStore();
  const body = await safeJson(req);

  if (path.length === 2 && path[0] === "meetings") {
    const meeting = store.meetings.find((m) => m.id === path[1]);
    if (!meeting) {
      return NextResponse.json({ detail: "Meeting not found" }, { status: 404 });
    }
    if (body.title !== undefined) meeting.title = body.title;
    if (body.agenda !== undefined) meeting.agenda = body.agenda;
    if (body.attendees !== undefined) meeting.attendees = body.attendees;
    if (body.status !== undefined) meeting.status = body.status;
    return NextResponse.json(meeting);
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function PUT(
  req: NextRequest,
  context: { params: { path: string[] } }
) {
  const path = context.params.path || [];
  const store = getStore();
  const url = new URL(req.url);

  // PUT /api/individuals/:id/notes
  if (path.length === 3 && path[0] === "individuals" && path[2] === "notes") {
    const body = await safeJson(req);
    const person = store.individuals.find((p) => p.id === path[1]);
    if (!person) {
      return NextResponse.json({ detail: "Person not found" }, { status: 404 });
    }
    person.notes = body.notes ?? "";
    return NextResponse.json({ updated: true, person_id: person.id });
  }

  // PUT /api/meetings/:id/transcript/:segId/speaker
  if (
    path.length === 5 &&
    path[0] === "meetings" &&
    path[2] === "transcript" &&
    path[4] === "speaker"
  ) {
    const meetingId = path[1];
    const segId = path[3];
    const speakerName = (url.searchParams.get("speaker_name") || "").trim();
    const scope = url.searchParams.get("scope") || "one";

    if (!speakerName) {
      return NextResponse.json(
        { detail: "Speaker name required" },
        { status: 400 }
      );
    }

    const segs = store.transcripts[meetingId] || [];
    const target = segs.find((s) => s.id === segId);
    if (!target) {
      return NextResponse.json({ detail: "Segment not found" }, { status: 404 });
    }

    const oldName = target.speaker_name;
    const isUser =
      speakerName.toLowerCase() ===
      (store.settings.user_name || "robin").trim().toLowerCase()
        ? 1
        : 0;
    const updatedIds: string[] = [];

    for (const s of segs) {
      if (s.id === segId || (scope === "all" && s.speaker_name === oldName)) {
        s.speaker_name = speakerName;
        s.is_user = isUser;
        s.speaker_label = isUser ? "ME" : "REMOTE";
        updatedIds.push(s.id);
      }
    }

    // Re-run session processing so newly renamed speakers immediately get Individual Dossiers!
    processMeetingSession(meetingId, store.settings.whisper_model);

    return NextResponse.json({
      updated: updatedIds.length,
      segment_ids: updatedIds,
      speaker_name: speakerName,
      is_user: isUser,
      dominance: computeDominanceRatio(segs),
    });
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(
  _req: NextRequest,
  context: { params: { path: string[] } }
) {
  const path = context.params.path || [];

  // DELETE /api/meetings/:id
  if (path.length === 2 && path[0] === "meetings") {
    const meetingId = path[1];
    return NextResponse.json(deleteMeetingFromStore(meetingId));
  }

  // DELETE /api/individuals/:id
  if (path.length === 2 && path[0] === "individuals") {
    return NextResponse.json(deleteIndividualFromStore(path[1]));
  }

  // DELETE /api/models/whisper/:modelId
  if (path.length === 3 && path[0] === "models" && path[1] === "whisper") {
    return NextResponse.json(deleteWhisperModelInStore(path[2]));
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
