"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Square,
  Chrome,
  MousePointerClick,
  Sparkles,
  ArrowRight,
  Mic,
  MonitorSpeaker,
  CheckCircle2,
  Download,
  Puzzle,
} from "lucide-react";
import { api, Meeting, ActiveRecording } from "@/lib/api";
import { useLiveEvents } from "@/lib/useLiveEvents";
import SessionList, { SessionProgress, formatDuration } from "@/components/SessionList";

export default function HomePage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [active, setActive] = useState<Record<string, ActiveRecording>>({});
  const [progress, setProgress] = useState<Record<string, SessionProgress>>({});
  const [loaded, setLoaded] = useState(false);
  const [backendOnline, setBackendOnline] = useState(true);
  const [autoProcess, setAutoProcess] = useState(true);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, recs, settings] = await Promise.all([
        api.getMeetings(),
        api.getActiveRecordings(),
        api.getSettings().catch(() => null),
      ]);
      setMeetings(list);
      setActive(Object.fromEntries(recs.map((r) => [r.meeting_id, r])));
      if (typeof settings?.auto_process_enabled === "boolean") setAutoProcess(settings.auto_process_enabled);
      setBackendOnline(true);
    } catch {
      setBackendOnline(false);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  useLiveEvents((ev) => {
    if (ev.type === "SETTINGS_UPDATED") {
      if (typeof ev.settings?.auto_process_enabled === "boolean") setAutoProcess(ev.settings.auto_process_enabled);
      return;
    }
    if (["MEETING_CREATED", "MEETING_UPDATED", "MEETING_DELETED", "SESSIONS_CLEARED"].includes(ev.type)) {
      refresh();
      return;
    }
    const id = ev.meeting_id;
    if (!id) return;
    switch (ev.type) {
      case "AUDIO_LEVEL":
        setActive((prev) => ({
          ...prev,
          [id]: { meeting_id: id, seconds: ev.seconds, mic_level: ev.mic_level, tab_level: ev.tab_level },
        }));
        break;
      case "RECORDING_STARTED":
        refresh();
        break;
      case "RECORDING_STOPPED":
        setActive((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        refresh();
        break;
      case "PROCESSING_PROGRESS":
        setProgress((prev) => ({ ...prev, [id]: { progress: ev.progress, message: ev.message } }));
        break;
      case "MEETING_PROCESSED":
      case "PROCESSING_ERROR":
        setProgress((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        refresh();
        break;
    }
  });

  const flash = (message: string) => {
    setStatusBanner(message);
    setTimeout(() => setStatusBanner(null), 6000);
  };

  const handleDelete = async (id: string) => {
    const target = meetings.find((m) => m.id === id);
    await api.deleteMeeting(id);
    flash(`Deleted "${target?.title || id}" and its audio and notes.`);
    refresh();
  };

  const handleStop = async (id: string) => {
    const target = meetings.find((m) => m.id === id);
    await api.stopMeeting(id);
    flash(`Stopping "${target?.title || "meeting"}" — the extension saves the last audio, then processing starts.`);
    refresh();
  };

  const handleToggleAutoProcess = async () => {
    const next = !autoProcess;
    setAutoProcess(next);
    await api.updateSettings({ auto_process_enabled: next });
  };

  const recordingNow = Object.values(active)
    .map((r) => ({ rec: r, meeting: meetings.find((m) => m.id === r.meeting_id) }))
    .filter((x) => x.meeting);
  const processingNow = meetings.filter((m) => progress[m.id]);

  return (
    <div className="space-y-6">
      {!backendOnline && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 font-medium pop-hover">
          The Quorum backend isn&apos;t reachable on localhost:8000. Start it with <code className="font-mono">./start.sh</code>.
        </div>
      )}

      {statusBanner && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900 font-semibold flex items-center gap-2 pop-hover">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{statusBanner}</span>
        </div>
      )}

      {recordingNow.length > 0 ? (
        recordingNow.map(({ rec, meeting }) => (
          <div key={rec.meeting_id} className="rounded-3xl border border-rose-200 bg-gradient-to-br from-rose-50 via-white to-white p-6 card-3d scroll-reveal">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-rose-600">
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                  Recording now
                </span>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-brand-charcoal tracking-tight mt-1">{meeting!.title}</h1>
                <p className="text-xs text-brand-slate mt-1">
                  {formatDuration(rec.seconds)} captured
                  {meeting?.attendees?.length ? ` · ${meeting.attendees.join(", ")}` : ""}
                </p>
              </div>
              <button
                onClick={() => handleStop(rec.meeting_id)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-brand-charcoal hover:opacity-90 btn-3d"
                title="Stop recording; the session is then transcribed and summarized"
              >
                <Square className="w-3.5 h-3.5 fill-white" />
                Stop recording
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5 max-w-xl">
              <LevelMeter icon={<Mic className="w-3.5 h-3.5" />} label="You (mic)" value={rec.mic_level || 0} color="from-brand-peach to-brand-coral" />
              <LevelMeter icon={<MonitorSpeaker className="w-3.5 h-3.5" />} label="Meeting audio" value={rec.tab_level || 0} color="from-indigo-300 to-indigo-500" />
            </div>
          </div>
        ))
      ) : (
        <div className="rounded-3xl bg-gradient-to-br from-white/95 via-white/90 to-brand-mist/70 border border-brand-pastel/80 p-6 space-y-5 card-3d scroll-reveal">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-brand-charcoal tracking-tight">
                Private meeting notes, on your machine
              </h1>
              <p className="text-xs text-brand-slate mt-1 max-w-2xl">
                Record any meeting tab with the Quorum extension. Whisper transcribes it and Gemma 4 writes the summary,
                decisions and who owns each next step — the recording never leaves your computer.
              </p>
            </div>

            <div className="flex flex-col items-start lg:items-end gap-2">
              <a
                href={api.getExtensionDownloadUrl()}
                download
                onClick={() => flash("Downloading the latest Quorum extension. Unzip it, open chrome://extensions and click “Load unpacked”.")}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold text-brand-charcoal bg-white border border-brand-peach hover:bg-brand-mist btn-3d-light whitespace-nowrap"
                title="Always built from the current extension code"
              >
                <Puzzle className="w-4 h-4 text-brand-coral" />
                <span>Download Chrome extension</span>
                <Download className="w-3.5 h-3.5 text-brand-coral" />
              </a>
              <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white border border-brand-pastel text-[11px] font-semibold text-brand-charcoal cursor-pointer btn-3d-light">
                <input type="checkbox" checked={autoProcess} onChange={handleToggleAutoProcess} className="accent-brand-coral rounded" />
                <span>Transcribe &amp; summarize when a recording stops</span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            <Step
              icon={<Chrome className="w-4 h-4" />}
              title="1 · Open your meeting"
              text="Any tab with audio: Google Meet, Zoom web, Teams, or a recorded call. Load the extension once in chrome://extensions."
            />
            <Step
              icon={<MousePointerClick className="w-4 h-4" />}
              title="2 · Start recording"
              text="Click the Quorum icon, then Start recording — or press ⌥⇧R. Your mic and the tab are saved as one session."
            />
            <Step
              icon={<Sparkles className="w-4 h-4" />}
              title="3 · Stop when you're done"
              text="Whisper transcribes on-device and Gemma 4 writes the summary, decisions and action items with owners."
            />
          </div>
        </div>
      )}

      {processingNow.length > 0 && (
        <div className="rounded-3xl bg-white/85 border border-indigo-100 p-5 space-y-3 card-3d scroll-reveal">
          {processingNow.map((m) => (
            <div key={m.id}>
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-brand-charcoal">{m.title}</span>
                <span className="font-mono text-indigo-600 font-semibold">{progress[m.id].progress}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-indigo-100 overflow-hidden mt-1.5">
                <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${progress[m.id].progress}%` }} />
              </div>
              <p className="text-[11px] text-brand-slate mt-1">{progress[m.id].message}</p>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-3xl bg-white/85 border border-brand-pastel/80 p-4 sm:p-5 card-3d scroll-reveal">
        <div className="flex items-center justify-between px-3 pb-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-brand-charcoal">Sessions</h2>
          <Link href="/meetings" className="text-xs font-semibold text-brand-coral flex items-center gap-1 hover:underline">
            View all <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {loaded ? (
          <SessionList meetings={meetings.slice(0, 10)} progress={progress} onDelete={handleDelete} />
        ) : (
          <div className="py-10 text-center text-xs text-brand-slate">Loading sessions…</div>
        )}
      </div>
    </div>
  );
}

function Step({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="p-4 rounded-2xl bg-white/90 border border-brand-pastel/80 pop-hover">
      <div className="flex items-center gap-2 text-brand-coral font-bold text-xs">
        {icon}
        <span className="text-brand-charcoal">{title}</span>
      </div>
      <p className="text-[11.5px] text-brand-slate leading-relaxed mt-1.5">{text}</p>
    </div>
  );
}

function LevelMeter({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="p-3 rounded-2xl bg-white/90 border border-brand-pastel/60 pop-hover">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-slate">
        {icon}
        {label}
      </div>
      <div className="h-1.5 rounded-full bg-brand-mist overflow-hidden mt-2">
        <div className={`h-full bg-gradient-to-r ${color} transition-all duration-200`} style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
    </div>
  );
}
