"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Radio, Square, Chrome, MousePointerClick, Sparkles, ArrowRight, Mic, MonitorSpeaker } from "lucide-react";
import { api, Meeting, ActiveRecording } from "@/lib/api";
import { useLiveEvents } from "@/lib/useLiveEvents";
import SessionList, { SessionProgress, formatDuration } from "@/components/SessionList";

export default function HomePage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [active, setActive] = useState<Record<string, ActiveRecording>>({});
  const [progress, setProgress] = useState<Record<string, SessionProgress>>({});
  const [loaded, setLoaded] = useState(false);
  const [backendOnline, setBackendOnline] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [list, recs] = await Promise.all([api.getMeetings(), api.getActiveRecordings()]);
      setMeetings(list);
      setActive(Object.fromEntries(recs.map((r) => [r.meeting_id, r])));
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
    const id = ev.meeting_id;
    if (!id) return;
    switch (ev.type) {
      case "AUDIO_LEVEL":
        setActive((prev) => ({ ...prev, [id]: { meeting_id: id, seconds: ev.seconds, mic_level: ev.mic_level, tab_level: ev.tab_level } }));
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

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this session, its audio and its notes?")) return;
    await api.deleteMeeting(id);
    refresh();
  };

  const handleStop = async (id: string) => {
    await api.stopMeeting(id);
    refresh();
  };

  const recordingNow = Object.values(active)
    .map((r) => ({ rec: r, meeting: meetings.find((m) => m.id === r.meeting_id) }))
    .filter((x) => x.meeting);
  const processingNow = meetings.filter((m) => progress[m.id]);

  return (
    <div className="space-y-6">
      {!backendOnline && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 font-medium">
          The AURA backend isn&apos;t reachable on localhost:8000. Start it with <code className="font-mono">./start.sh</code>.
        </div>
      )}

      {/* Now */}
      {recordingNow.length > 0 ? (
        recordingNow.map(({ rec, meeting }) => (
          <div key={rec.meeting_id} className="rounded-3xl border border-rose-200 bg-gradient-to-br from-rose-50 via-white to-white shadow-peach-md p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-rose-600">
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                  Recording now
                </span>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-aura-charcoal tracking-tight mt-1">{meeting!.title}</h1>
                <p className="text-xs text-aura-slate mt-1">
                  {formatDuration(rec.seconds)} captured · transcript, summary and action items are generated when the meeting ends.
                </p>
              </div>
              <button
                onClick={() => handleStop(rec.meeting_id)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white bg-aura-charcoal hover:opacity-90 shadow-peach-sm"
                title="Stop recording and process this session (the extension also stops automatically when you leave the call)"
              >
                <Square className="w-3.5 h-3.5 fill-white" />
                Stop & process
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5 max-w-xl">
              <LevelMeter icon={<Mic className="w-3.5 h-3.5" />} label="You (mic)" value={rec.mic_level || 0} color="from-aura-peach to-aura-coral" />
              <LevelMeter icon={<MonitorSpeaker className="w-3.5 h-3.5" />} label="Meeting audio" value={rec.tab_level || 0} color="from-indigo-300 to-indigo-500" />
            </div>
          </div>
        ))
      ) : (
        <div className="rounded-3xl bg-gradient-to-br from-white/95 via-white/85 to-aura-mist/60 border border-aura-pastel/80 shadow-peach-md p-6">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-aura-mist text-aura-coral border border-aura-pastel">
            <Radio className="w-3.5 h-3.5" />
            No meeting in progress
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-aura-charcoal tracking-tight mt-3">Join a call, AURA takes it from there</h1>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
            <Step icon={<Chrome className="w-4 h-4" />} title="1 · Join a meeting" text="Google Meet, Zoom (web) or Teams in Chrome. The extension detects when you're in the call." />
            <Step icon={<MousePointerClick className="w-4 h-4" />} title="2 · One click to record" text="Click the AURA toolbar icon or press ⌥⇧R. Each meeting is recorded as its own session." />
            <Step icon={<Sparkles className="w-4 h-4" />} title="3 · Leave the call" text="Recording stops automatically, then Whisper transcribes and Gemma writes the summary and to-dos." />
          </div>
        </div>
      )}

      {processingNow.length > 0 && (
        <div className="rounded-3xl bg-white/85 border border-indigo-100 shadow-peach-sm p-5 space-y-3">
          {processingNow.map((m) => (
            <div key={m.id}>
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-aura-charcoal">{m.title}</span>
                <span className="font-mono text-indigo-600 font-semibold">{progress[m.id].progress}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-indigo-100 overflow-hidden mt-1.5">
                <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${progress[m.id].progress}%` }} />
              </div>
              <p className="text-[11px] text-aura-slate mt-1">{progress[m.id].message}</p>
            </div>
          ))}
        </div>
      )}

      {/* Sessions */}
      <div className="rounded-3xl bg-white/85 border border-aura-pastel/80 shadow-peach-sm p-4 sm:p-5">
        <div className="flex items-center justify-between px-3 pb-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-aura-charcoal">Sessions</h2>
          <Link href="/meetings" className="text-xs font-semibold text-aura-coral flex items-center gap-1 hover:underline">
            View all <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {loaded ? (
          <SessionList meetings={meetings.slice(0, 10)} progress={progress} onDelete={handleDelete} />
        ) : (
          <div className="py-10 text-center text-xs text-aura-slate">Loading sessions…</div>
        )}
      </div>
    </div>
  );
}

function Step({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="p-4 rounded-2xl bg-white/80 border border-aura-pastel/70">
      <div className="flex items-center gap-2 text-aura-coral font-bold text-xs">
        {icon}
        <span className="text-aura-charcoal">{title}</span>
      </div>
      <p className="text-[11.5px] text-aura-slate leading-relaxed mt-1.5">{text}</p>
    </div>
  );
}

function LevelMeter({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="p-3 rounded-2xl bg-white/90 border border-aura-pastel/60">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-aura-slate">
        {icon}
        {label}
      </div>
      <div className="h-1.5 rounded-full bg-aura-mist overflow-hidden mt-2">
        <div className={`h-full bg-gradient-to-r ${color} transition-all duration-200`} style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
    </div>
  );
}
