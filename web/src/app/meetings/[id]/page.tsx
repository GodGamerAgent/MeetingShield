"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  FileText, CheckSquare, Bookmark, Calendar, Clock, Sparkles, Check, ShieldCheck, XCircle,
  Mail, FileDown, Loader2, AlertTriangle, RotateCw, Users, Edit3, ArrowLeft, Lightbulb, Layers, Trash2, CheckCircle2,
} from "lucide-react";
import { api, Meeting, TodoItem, MemoryCard, TranscriptSegment, DominanceData, CoachingCard } from "@/lib/api";
import { useLiveEvents } from "@/lib/useLiveEvents";
import CalendarModal from "@/components/CalendarModal";
import LiveNotesPad from "@/components/LiveNotesPad";
import FollowUpDrafterModal from "@/components/FollowUpDrafterModal";
import NotesMarkdownModal from "@/components/NotesMarkdownModal";
import MeetingChatbot from "@/components/MeetingChatbot";
import DominanceChart from "@/components/DominanceChart";
import { StatusBadge, formatDuration } from "@/components/SessionList";

interface Analysis {
  has_analysis: boolean;
  executive_summary: string;
  decisions: string[];
  rejected_alternatives: string[];
  action_plan: { phase: string; details: string }[];
  todos: TodoItem[];
  things_to_remember: MemoryCard[];
  behavioral_coaching: CoachingCard[];
  epochs: any[];
}

const card = "rounded-3xl bg-white/85 backdrop-blur-md border border-brand-pastel/80 shadow-peach-sm p-5 sm:p-6";

function tsToSeconds(ts: string) {
  const [h, m, s] = ts.split(":").map(Number);
  return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
}

export default function MeetingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const meetingId = (params?.id as string) || "";

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [dominance, setDominance] = useState<DominanceData | null>(null);
  const [userName, setUserName] = useState("Me");
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<{ progress: number; message: string } | null>(null);
  const [synthesizing, setSynthesizing] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState("ALL");
  const [isFollowupOpen, setIsFollowupOpen] = useState(false);
  const [isMarkdownOpen, setIsMarkdownOpen] = useState(false);
  const [calTask, setCalTask] = useState<{ title: string; deadline?: string; description?: string } | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [actionBanner, setActionBanner] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const loadAll = useCallback(async () => {
    if (!meetingId) return;
    try {
      const [m, a, t, d, settings, status] = await Promise.all([
        api.getMeeting(meetingId),
        api.getAnalysis(meetingId),
        api.getTranscript(meetingId),
        api.getDominance(meetingId),
        api.getSettings().catch(() => ({})),
        api.getProcessingStatus(meetingId).catch(() => null),
      ]);
      setMeeting(m);
      setAnalysis(a);
      setTranscript(t);
      setDominance(d);
      setTitleDraft(m.title);
      if (settings?.user_name) setUserName(settings.user_name);
      setProgress(status?.status === "processing" ? { progress: status.progress, message: status.message } : null);
    } catch {
      setMeeting(null);
    } finally {
      setLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    setLoading(true);
    loadAll();
  }, [loadAll]);

  useLiveEvents((ev) => {
    if (ev.type === "SESSIONS_CLEARED") {
      setMeeting(null);
      return;
    }
    if (ev.meeting_id !== meetingId) return;
    if (ev.type === "MEETING_DELETED") {
      setMeeting(null);
    } else if (ev.type === "MEETING_UPDATED" && ev.meeting) {
      // Renamed / re-scoped from the extension or another tab
      setMeeting((m) => (m ? { ...m, ...ev.meeting } : ev.meeting));
      if (!editingTitle) setTitleDraft(ev.meeting.title);
    } else if (ev.type === "RECORDING_STARTED") {
      setMeeting((m) => (m ? { ...m, status: "recording" } : m));
    } else if (ev.type === "PROCESSING_PROGRESS") {
      setProgress({ progress: ev.progress, message: ev.message });
      setMeeting((m) => (m ? { ...m, status: "processing" } : m));
    } else if (ev.type === "MEETING_PROCESSED" || ev.type === "PROCESSING_ERROR" || ev.type === "RECORDING_STOPPED") {
      setProgress(null);
      loadAll();
    }
  });

  const handleProcess = async () => {
    setProgress({ progress: 25, message: "Transcribing audio, updating Coach & People Dossiers…" });
    setMeeting((m) => (m ? { ...m, status: "processing", processing_error: "" } : m));
    try {
      await api.processMeeting(meetingId);
      setActionBanner("Session processed! Transcript, Executive Summary, Personal Communication Coach, and Individual Dossiers updated.");
      setTimeout(() => setActionBanner(null), 5000);
    } finally {
      setProgress(null);
      await loadAll();
    }
  };

  const handleResynthesize = async () => {
    setSynthesizing(true);
    try {
      setAnalysis(await api.generateAnalysis(meetingId));
      setActionBanner("Re-summarized session and updated Behavioral Coach & Individual Dossiers!");
      setTimeout(() => setActionBanner(null), 5000);
    } finally {
      setSynthesizing(false);
    }
  };

  const handleDeleteSession = async () => {
    await api.deleteMeeting(meetingId);
    router.push("/meetings");
  };

  const handleSaveTitle = async () => {
    const title = titleDraft.trim();
    setEditingTitle(false);
    if (!title || title === meeting?.title) return;
    setMeeting(await api.updateMeeting(meetingId, { title }));
  };

  const handleRename = async (seg: TranscriptSegment, name: string, scope: "one" | "all") => {
    const res = await api.reassignSpeaker(meetingId, seg.id, name, scope);
    const ids = new Set<string>(res.segment_ids);
    setTranscript((prev) => prev.map((s) => (ids.has(s.id) ? { ...s, speaker_name: name, is_user: res.is_user } : s)));
    setDominance(res.dominance);
  };

  const jumpTo = (ts: string) => {
    const secs = tsToSeconds(ts);
    const target = [...transcript].reverse().find((s) => s.start_time <= secs + 0.5) || transcript[0];
    const el = target ? document.getElementById(`seg-${target.id}`) : null;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-brand-coral");
      setTimeout(() => el.classList.remove("ring-2", "ring-brand-coral"), 2500);
    }
    if (audioRef.current) {
      audioRef.current.currentTime = tsToSeconds(ts);
      audioRef.current.play().catch(() => {});
    }
  };

  const handleToggleTodo = async (todoId: string) => {
    const res = await api.toggleTodo(todoId);
    setAnalysis((a) => (a ? { ...a, todos: a.todos.map((t) => (t.id === todoId ? { ...t, completed: res.completed ? 1 : 0 } : t)) } : a));
  };

  const speakerOptions = useMemo(() => {
    const names = new Set<string>([userName, ...transcript.map((s) => s.speaker_name), ...(meeting?.attendees || [])]);
    names.delete("");
    return Array.from(names);
  }, [transcript, meeting, userName]);

  const owners = useMemo(() => Array.from(new Set((analysis?.todos || []).map((t) => t.owner).filter(Boolean))), [analysis]);
  const todos = (analysis?.todos || []).filter((t) => ownerFilter === "ALL" || t.owner === ownerFilter);

  if (loading) {
    return (
      <div className="p-16 text-center text-xs text-brand-slate flex flex-col items-center gap-3">
        <Loader2 className="w-6 h-6 text-brand-coral animate-spin" />
        Loading session…
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className={`${card} text-center space-y-3`}>
        <h2 className="text-xl font-bold text-brand-charcoal">Session not found</h2>
        <p className="text-xs text-brand-slate">It may have been deleted.</p>
        <Link href="/meetings" className="inline-block px-4 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-brand-peach to-brand-coral">
          All sessions
        </Link>
      </div>
    );
  }

  const isProcessing = meeting.status === "processing" || Boolean(progress);
  const isRecording = meeting.status === "recording";
  const hasTranscript = transcript.length > 0;

  return (
    <div className="space-y-6">
      {actionBanner && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-900 flex items-center gap-2 pop-hover">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{actionBanner}</span>
        </div>
      )}

      {/* Header */}
      <div className={card}>
        <button
          type="button"
          onClick={() => router.push("/meetings")}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-slate hover:text-brand-coral mb-3 cursor-pointer"
        >
          <ArrowLeft className="w-3 h-3" /> Sessions
        </button>
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-brand-slate font-medium">
              <StatusBadge status={meeting.status} progress={progress || undefined} />
              <span suppressHydrationWarning>{new Date(meeting.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
              {meeting.duration_sec > 0 && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDuration(meeting.duration_sec)}</span>}
            </div>
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={handleSaveTitle}
                onKeyDown={(e) => e.key === "Enter" && handleSaveTitle()}
                className="mt-2 w-full text-2xl sm:text-3xl font-extrabold text-brand-charcoal bg-transparent border-b-2 border-brand-coral focus:outline-none"
              />
            ) : (
              <h1 className="mt-2 text-2xl sm:text-3xl font-extrabold text-brand-charcoal tracking-tight flex items-center gap-2 group">
                <span className="truncate">{meeting.title}</span>
                <button
                  type="button"
                  onClick={() => setEditingTitle(true)}
                  className="p-1 rounded-lg opacity-70 hover:opacity-100 text-brand-slate hover:text-brand-coral hover:bg-brand-mist"
                  title="Rename session"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
              </h1>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 relative z-10">
            {!isRecording && meeting.has_audio && (
              <button
                type="button"
                onClick={handleProcess}
                disabled={isProcessing}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-brand-peach to-brand-coral btn-3d disabled:opacity-50"
                title="Re-run transcription and AI synthesis"
              >
                {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
                {hasTranscript ? "Re-process" : "Process"}
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsFollowupOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white text-brand-charcoal border border-brand-pastel hover:bg-brand-mist btn-3d-light"
            >
              <Mail className="w-3.5 h-3.5 text-brand-coral" /> Follow-up
            </button>
            <button
              type="button"
              onClick={() => setIsMarkdownOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white text-brand-charcoal border border-brand-pastel hover:bg-brand-mist btn-3d-light"
              title="Open GitHub & Obsidian Markdown Viewer"
            >
              <FileText className="w-3.5 h-3.5 text-brand-coral" /> Notes .md
            </button>
            <button
              type="button"
              onClick={handleDeleteSession}
              aria-label="Delete session"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 btn-3d-light"
              title="Delete session and remove storage files"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete</span>
            </button>
          </div>
        </div>

        {meeting.has_audio && !isRecording && (
          <audio ref={audioRef} controls preload="none" src={api.getAudioDownloadUrl(meetingId)} className="w-full mt-4 h-9" />
        )}

        {isProcessing && progress && (
          <div className="mt-4 p-3 rounded-2xl bg-indigo-50/70 border border-indigo-100">
            <div className="flex justify-between text-[11px] font-semibold text-indigo-800">
              <span>{progress.message}</span>
              <span className="font-mono">{progress.progress}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-indigo-100 overflow-hidden mt-2">
              <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${progress.progress}%` }} />
            </div>
          </div>
        )}
        {meeting.status === "error" && meeting.processing_error && (
          <div className="mt-4 p-3 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>Processing failed: {meeting.processing_error}</span>
          </div>
        )}
        {isRecording && (
          <div className="mt-4 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
            This meeting is still being recorded. Transcript and summary appear here once it ends.
          </div>
        )}
        {meeting.status === "recorded" && !hasTranscript && !isProcessing && (
          <div className="mt-4 p-3 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
            {meeting.has_audio ? "This session was recorded but hasn't been processed yet. Click Process." : "No audio was captured for this session."}
          </div>
        )}
      </div>

      {/* Summary */}
      {(analysis?.has_analysis || hasTranscript) && (
        <div className={`${card} space-y-4`}>
          <SectionTitle icon={<FileText className="w-4 h-4" />} title="Summary">
            <button onClick={handleResynthesize} disabled={synthesizing || !hasTranscript || isProcessing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold text-brand-coral bg-brand-mist border border-brand-pastel disabled:opacity-50">
              <Sparkles className={`w-3.5 h-3.5 ${synthesizing ? "animate-spin" : ""}`} />
              {synthesizing ? "Summarizing…" : "Re-summarize"}
            </button>
          </SectionTitle>
          <p className="text-[13px] leading-relaxed text-brand-charcoal whitespace-pre-line">
            {analysis?.executive_summary || "No summary yet."}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ListBox tone="emerald" icon={<ShieldCheck className="w-4 h-4" />} title="Decisions" items={analysis?.decisions || []} empty="No decisions recorded." onCite={jumpTo} />
            <ListBox tone="rose" icon={<XCircle className="w-4 h-4" />} title="Rejected alternatives" items={analysis?.rejected_alternatives || []} empty="None discussed." onCite={jumpTo} />
          </div>
          {(analysis?.action_plan || []).length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {analysis!.action_plan.map((p, i) => (
                <div key={i} className="p-3.5 rounded-2xl bg-brand-mist/50 border border-brand-pastel/60 text-xs">
                  <div className="font-bold text-brand-charcoal">{p.phase}</div>
                  <p className="text-brand-slate mt-1 leading-relaxed">{p.details}</p>
                </div>
              ))}
            </div>
          )}
          {(analysis?.epochs || []).length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer font-semibold text-brand-slate flex items-center gap-1.5"><Layers className="w-3.5 h-3.5" /> Section digests ({analysis!.epochs.length})</summary>
              <div className="mt-2 space-y-2">
                {analysis!.epochs.map((e: any) => (
                  <div key={e.id} className="p-3 rounded-xl bg-brand-mist/40 border border-brand-pastel/50">
                    <div className="font-bold text-brand-charcoal">Minutes {e.start_min}–{e.end_min}</div>
                    <p className="whitespace-pre-line text-brand-slate mt-1">{e.summary_markdown}</p>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* To-dos */}
      {analysis?.has_analysis && (
        <div className={`${card} space-y-4`}>
          <SectionTitle icon={<CheckSquare className="w-4 h-4" />} title={`Action items (${analysis.todos.length})`}>
            {owners.length > 1 && (
              <div className="flex items-center gap-1 overflow-x-auto bg-brand-mist p-1 rounded-xl border border-brand-pastel/60">
                {["ALL", ...owners].map((o) => (
                  <button key={o} onClick={() => setOwnerFilter(o)}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap ${ownerFilter === o ? "bg-white text-brand-coral shadow-xs" : "text-brand-slate"}`}>
                    {o === "ALL" ? "All" : o}
                  </button>
                ))}
              </div>
            )}
          </SectionTitle>
          {todos.length === 0 ? (
            <p className="text-xs text-brand-slate text-center py-4">No action items found in this meeting.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {todos.map((t) => {
                const done = t.completed === 1;
                return (
                  <div key={t.id} className={`p-4 rounded-2xl border flex flex-col gap-3 ${done ? "bg-slate-50 border-slate-200 opacity-70" : "bg-white border-brand-pastel/80"}`}>
                    <div className="flex items-start gap-3">
                      <button onClick={() => handleToggleTodo(t.id)}
                        className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 mt-0.5 ${done ? "bg-brand-coral border-brand-coral text-white" : "border-brand-pastel bg-white hover:border-brand-peach"}`}>
                        {done && <Check className="w-3.5 h-3.5" />}
                      </button>
                      <p className={`text-xs font-semibold leading-snug flex-1 ${done ? "line-through text-brand-slate" : "text-brand-charcoal"}`}>{t.task}</p>
                      <PriorityBadge priority={t.priority} />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-brand-slate">
                      <span>
                        <span className="font-semibold text-brand-charcoal">{t.owner}</span>
                        {t.deadline && <> · {t.deadline}</>}
                        {" · "}
                        <button onClick={() => jumpTo(t.timestamp_ref)} className="font-mono hover:text-brand-coral">{t.timestamp_ref}</button>
                      </span>
                      <button onClick={() => setCalTask({ title: t.task, deadline: t.deadline, description: `Owner: ${t.owner}\nMeeting: ${meeting.title}` })}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg font-bold text-brand-coral bg-brand-mist border border-brand-pastel">
                        <Calendar className="w-3 h-3" /> Calendar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Transcript + Chat */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className={`lg:col-span-7 ${card} flex flex-col h-[640px]`}>
          <SectionTitle icon={<Clock className="w-4 h-4" />} title={`Transcript (${transcript.length})`}>
            <span className="text-[10.5px] text-brand-slate">Click a time to play from there</span>
          </SectionTitle>
          {hasTranscript ? (
            <div className="flex-1 overflow-y-auto mt-3 space-y-2.5 pr-1">
              {transcript.map((seg) => (
                <TranscriptRow key={seg.id} seg={seg} options={speakerOptions} onJump={jumpTo} onRename={handleRename} />
              ))}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-xs text-brand-slate space-y-3">
              <Clock className="w-8 h-8 text-brand-coral/70" />
              <p className="font-bold text-brand-charcoal text-sm">No Transcript Generated Yet</p>
              <p className="max-w-sm leading-relaxed">
                Click <strong>Process</strong> above (or <strong>Stop &amp; process</strong> if recording) to run Faster-Whisper ASR and generate speaker-attributed transcript segments.
              </p>
            </div>
          )}
        </div>
        <div className="lg:col-span-5 space-y-6">
          {dominance && dominance.speakers.length > 0 && (
            <div className={card}>
              <DominanceChart dominanceData={dominance} />
            </div>
          )}
          <div className="h-[560px]">
            <MeetingChatbot
              meetingId={meetingId}
              meetingTitle={meeting.title}
              attendees={meeting.attendees}
              onCitationClick={jumpTo}
            />
          </div>
        </div>
      </div>

      {/* Notes */}
      <LiveNotesPad
        meetingId={meetingId}
        initialRawNotes={meeting.raw_notes}
        initialEnhancedNotes={meeting.enhanced_notes}
        folderPath={meeting.folder_path}
        onOpenMarkdown={() => setIsMarkdownOpen(true)}
      />

      {/* Things to remember */}
      {(analysis?.things_to_remember || []).length > 0 && (
        <div className={`${card} space-y-4`}>
          <SectionTitle icon={<Bookmark className="w-4 h-4" />} title="Things to remember" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {analysis!.things_to_remember.map((m) => (
              <div key={m.id} className="p-4 rounded-2xl bg-gradient-to-br from-brand-mist/70 to-white border border-brand-pastel/80 text-xs space-y-1.5">
                <div className="flex justify-between text-[10px]">
                  <span className="font-bold uppercase tracking-wider text-brand-coral">{m.category}</span>
                  <button onClick={() => jumpTo(m.timestamp_ref)} className="font-mono text-brand-slate hover:text-brand-coral">{m.timestamp_ref}</button>
                </div>
                <p className="font-bold text-brand-charcoal leading-snug">{m.fact}</p>
                {m.context && <p className="text-brand-slate">{m.context}</p>}
                {m.person && <p className="text-brand-slate">— {m.person}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Coaching for this meeting */}
      {(analysis?.behavioral_coaching || []).length > 0 && (
        <div className={`${card} space-y-4`}>
          <SectionTitle icon={<Lightbulb className="w-4 h-4" />} title="How you came across" />
          <div className="space-y-3">
            {analysis!.behavioral_coaching.map((c) => (
              <div key={c.id} className="p-4 rounded-2xl border border-brand-pastel/70 bg-white text-xs space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => jumpTo(c.timestamp_ref)} className="font-mono text-[10.5px] text-brand-slate hover:text-brand-coral">{c.timestamp_ref}</button>
                  <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-semibold text-[10.5px]">{c.tone_detected}</span>
                  <span className="text-[10.5px] text-brand-slate">Clarity {c.clarity_score} · Empathy {c.empathy_score}</span>
                </div>
                <p className="italic text-brand-charcoal">&ldquo;{c.what_you_said}&rdquo;</p>
                <p className="text-brand-slate">{c.impact_analysis}</p>
                <p className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900"><span className="font-bold">Try: </span>{c.better_response}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <CalendarModal isOpen={Boolean(calTask)} onClose={() => setCalTask(null)} taskTitle={calTask?.title || ""} deadline={calTask?.deadline} description={calTask?.description} />
      <FollowUpDrafterModal meetingId={meetingId} meetingTitle={meeting.title} isOpen={isFollowupOpen} onClose={() => setIsFollowupOpen(false)} />
      <NotesMarkdownModal
        meetingId={meetingId}
        meetingTitle={meeting.title}
        isOpen={isMarkdownOpen}
        onClose={() => setIsMarkdownOpen(false)}
        onCitationClick={jumpTo}
      />
    </div>
  );
}

function SectionTitle({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-brand-border">
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-lg bg-brand-mist text-brand-coral border border-brand-pastel">{icon}</div>
        <h2 className="text-xs font-bold uppercase tracking-wider text-brand-charcoal">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function withCitations(text: string, onCite: (ts: string) => void) {
  return text.split(/(\[\d{2}:\d{2}:\d{2}\])/g).map((part, i) => {
    const m = part.match(/^\[(\d{2}:\d{2}:\d{2})\]$/);
    return m ? (
      <button key={i} onClick={() => onCite(m[1])} className="font-mono text-[10px] px-1 rounded bg-white border border-brand-pastel text-brand-coral mx-0.5">{m[1]}</button>
    ) : (
      <span key={i}>{part}</span>
    );
  });
}

function ListBox({ tone, icon, title, items, empty, onCite }: { tone: "emerald" | "rose"; icon: React.ReactNode; title: string; items: string[]; empty: string; onCite: (ts: string) => void }) {
  const styles = tone === "emerald" ? "bg-emerald-50/70 border-emerald-200/80 text-emerald-900" : "bg-rose-50/70 border-rose-200/80 text-rose-900";
  return (
    <div className={`p-4 rounded-2xl border space-y-2 ${styles}`}>
      <div className="flex items-center gap-2 font-bold text-xs uppercase tracking-wider">{icon}{title}</div>
      {items.length === 0 ? (
        <p className="text-[11px] text-brand-slate">{empty}</p>
      ) : (
        <ul className="space-y-1.5 text-xs font-medium">
          {items.map((d, i) => <li key={i} className="leading-relaxed">• {withCitations(d, onCite)}</li>)}
        </ul>
      )}
    </div>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const cls = { HIGH: "bg-rose-100 text-rose-800 border-rose-200", MEDIUM: "bg-amber-100 text-amber-800 border-amber-200", LOW: "bg-emerald-100 text-emerald-800 border-emerald-200" }[priority] || "bg-slate-100 text-slate-700 border-slate-200";
  return <span className={`text-[9.5px] font-bold px-2 py-0.5 rounded-full border ${cls}`}>{priority}</span>;
}

function TranscriptRow({ seg, options, onJump, onRename }: {
  seg: TranscriptSegment;
  options: string[];
  onJump: (ts: string) => void;
  onRename: (seg: TranscriptSegment, name: string, scope: "one" | "all") => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const [applyAll, setApplyAll] = useState(true);

  const pick = async (name: string) => {
    if (!name.trim()) return;
    setOpen(false);
    setCustom("");
    await onRename(seg, name.trim(), applyAll ? "all" : "one");
  };

  return (
    <div id={`seg-${seg.id}`} className={`p-3 rounded-2xl border text-xs leading-relaxed transition-shadow ${seg.is_user ? "bg-gradient-to-r from-brand-mist/90 to-white border-brand-peach/50" : "bg-white/80 border-brand-border"}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="relative">
          <button onClick={() => setOpen((o) => !o)} title="Rename speaker"
            className={`text-[11px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 ${seg.is_user ? "bg-brand-peach text-white" : "bg-slate-100 text-brand-charcoal border border-slate-200"}`}>
            {seg.speaker_label === "UNKNOWN" ? <Users className="w-3 h-3" /> : null}
            {seg.speaker_name}
          </button>
          {open && (
            <div className="absolute z-20 mt-1 w-56 p-2 rounded-xl bg-white border border-brand-pastel shadow-peach-md space-y-1">
              {options.map((o) => (
                <button key={o} onClick={() => pick(o)} className="block w-full text-left px-2 py-1 rounded-lg hover:bg-brand-mist text-[11.5px]">{o}</button>
              ))}
              <input value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && pick(custom)}
                placeholder="Other name + Enter" className="w-full px-2 py-1 rounded-lg border border-brand-pastel text-[11.5px] focus:outline-none" />
              <label className="flex items-center gap-1.5 px-1 pt-1 text-[10.5px] text-brand-slate">
                <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} className="accent-brand-coral" />
                Rename every &ldquo;{seg.speaker_name}&rdquo; line
              </label>
            </div>
          )}
        </div>
        <button onClick={() => onJump(seg.timestamp_badge)} className="font-mono text-[10px] font-semibold text-brand-slate hover:text-brand-coral bg-white px-2 py-0.5 rounded border border-brand-pastel/60">
          {seg.timestamp_badge}
        </button>
      </div>
      <p className="text-brand-charcoal">{seg.text}</p>
    </div>
  );
}
