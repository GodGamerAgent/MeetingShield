"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Radio,
  Square,
  Chrome,
  MousePointerClick,
  Sparkles,
  ArrowRight,
  Mic,
  MonitorSpeaker,
  CheckCircle2,
  Radar,
  Users,
  UserCheck,
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

  // Automatic Meeting Detection state
  const [autoDetectEnabled, setAutoDetectEnabled] = useState(true);
  const [autoRecordEnabled, setAutoRecordEnabled] = useState(true);
  const [selectedPlatform, setSelectedPlatform] = useState<"meet" | "zoom" | "teams">("meet");
  const [detecting, setDetecting] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, recs, det] = await Promise.all([
        api.getMeetings(),
        api.getActiveRecordings(),
        api.getDetectionStatus().catch(() => null),
      ]);
      setMeetings(list);
      setActive(Object.fromEntries(recs.map((r) => [r.meeting_id, r])));
      if (det) {
        setAutoDetectEnabled(det.auto_detect_enabled);
        setAutoRecordEnabled(det.auto_record_enabled);
      }
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
        setActive((prev) => ({
          ...prev,
          [id]: {
            meeting_id: id,
            seconds: ev.seconds,
            mic_level: ev.mic_level,
            tab_level: ev.tab_level,
          },
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
        setProgress((prev) => ({
          ...prev,
          [id]: { progress: ev.progress, message: ev.message },
        }));
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
    const target = meetings.find((m) => m.id === id);
    await api.deleteMeeting(id);
    setStatusBanner(
      `Deleted session "${target?.title || id}" and removed its audio (.wav) and markdown (.md) files from disk storage.`
    );
    setTimeout(() => setStatusBanner(null), 5000);
    refresh();
  };

  const handleStop = async (id: string) => {
    const target = meetings.find((m) => m.id === id);
    await api.stopMeeting(id);
    setStatusBanner(
      `Processed "${target?.title || "Meeting"}": Transcript, Summary, Personal Behavioral Coach, and Individual Dossiers updated!`
    );
    setTimeout(() => setStatusBanner(null), 6000);
    refresh();
  };

  const handleSimulateDetect = async () => {
    setDetecting(true);
    try {
      const res = await api.simulateMeetingDetection({
        platform: selectedPlatform,
        auto_start_recording: true,
      });
      if (res?.meeting) {
        setStatusBanner(
          `Auto-detected active ${selectedPlatform.toUpperCase()} call "${res.meeting.title}" with participants (${(res.meeting.attendees || []).join(", ")}) — stereo recording started!`
        );
        setTimeout(() => setStatusBanner(null), 6000);
      }
      await refresh();
    } finally {
      setDetecting(false);
    }
  };

  const handleToggleAutoDetect = async () => {
    const next = !autoDetectEnabled;
    setAutoDetectEnabled(next);
    await api.updateDetectionSettings({ auto_detect_enabled: next });
  };

  const handleToggleAutoRecord = async () => {
    const next = !autoRecordEnabled;
    setAutoRecordEnabled(next);
    await api.updateDetectionSettings({ auto_record_enabled: next });
  };

  const handleExtensionDownloadNotice = () => {
    setStatusBanner(
      "Downloading aura-meet-chrome-extension.zip! Unzip it, open chrome://extensions, enable Developer mode, and click 'Load unpacked'."
    );
    setTimeout(() => setStatusBanner(null), 6000);
  };

  const recordingNow = Object.values(active)
    .map((r) => ({ rec: r, meeting: meetings.find((m) => m.id === r.meeting_id) }))
    .filter((x) => x.meeting);
  const processingNow = meetings.filter((m) => progress[m.id]);

  return (
    <div className="space-y-6">
      {!backendOnline && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 font-medium pop-hover">
          The AURA backend isn&apos;t reachable on localhost:8000. Start it with <code className="font-mono">./start.sh</code>.
        </div>
      )}

      {statusBanner && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900 font-semibold flex flex-wrap items-center justify-between gap-3 pop-hover">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>{statusBanner}</span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/coach"
              className="px-2.5 py-1 rounded-lg bg-white border border-emerald-200 text-emerald-800 hover:bg-emerald-100 font-bold flex items-center gap-1 btn-3d-light"
            >
              <UserCheck className="w-3.5 h-3.5" /> View Coach
            </Link>
            <Link
              href="/people"
              className="px-2.5 py-1 rounded-lg bg-white border border-emerald-200 text-emerald-800 hover:bg-emerald-100 font-bold flex items-center gap-1 btn-3d-light"
            >
              <Users className="w-3.5 h-3.5" /> View Dossiers
            </Link>
          </div>
        </div>
      )}

      {/* Now Recording or Auto-Detection Welcome Hero */}
      {recordingNow.length > 0 ? (
        recordingNow.map(({ rec, meeting }) => (
          <div key={rec.meeting_id} className="rounded-3xl border border-rose-200 bg-gradient-to-br from-rose-50 via-white to-white p-6 card-3d scroll-reveal">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-rose-600">
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                    Recording now · {(meeting?.platform || "meet").toUpperCase()} Auto-Detected
                  </span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-aura-charcoal tracking-tight mt-1">{meeting!.title}</h1>
                <p className="text-xs text-aura-slate mt-1">
                  {formatDuration(rec.seconds)} captured · Participants: {(meeting?.attendees || []).join(", ") || "Detecting..."}
                </p>
                <p className="text-[11px] text-aura-coral font-semibold mt-1">
                  When stopped, AURA transcribes audio, summarizes decisions, and updates both your Behavioral Coach and Individual Dossiers.
                </p>
              </div>
              <button
                onClick={() => handleStop(rec.meeting_id)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-aura-charcoal hover:opacity-90 btn-3d"
                title="Stop recording and process this session (updates Transcript, Summary, Behavioral Coach, and People Dossiers)"
              >
                <Square className="w-3.5 h-3.5 fill-white" />
                Stop &amp; process
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5 max-w-xl">
              <LevelMeter icon={<Mic className="w-3.5 h-3.5" />} label="You (mic)" value={rec.mic_level || 0.65} color="from-aura-peach to-aura-coral" />
              <LevelMeter icon={<MonitorSpeaker className="w-3.5 h-3.5" />} label="Meeting audio" value={rec.tab_level || 0.52} color="from-indigo-300 to-indigo-500" />
            </div>
          </div>
        ))
      ) : (
        <div className="rounded-3xl bg-gradient-to-br from-white/95 via-white/90 to-aura-mist/70 border border-aura-pastel/80 p-6 space-y-5 card-3d scroll-reveal">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <Radar className="w-3.5 h-3.5" />
                {autoDetectEnabled ? "Automatic Meeting Detection Active" : "Auto-Detection Paused"}
              </span>
              <span className="text-xs text-aura-slate font-medium hidden sm:inline">
                Monitoring Google Meet, Zoom &amp; Microsoft Teams
              </span>
            </div>

            {/* Auto-Detect & Auto-Record Toggles + Simulate Live Call Trigger */}
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white border border-aura-pastel text-[11px] font-semibold text-aura-charcoal cursor-pointer btn-3d-light">
                <input
                  type="checkbox"
                  checked={autoDetectEnabled}
                  onChange={handleToggleAutoDetect}
                  className="accent-aura-coral rounded"
                />
                <span>Auto-Detect Calls</span>
              </label>

              <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white border border-aura-pastel text-[11px] font-semibold text-aura-charcoal cursor-pointer btn-3d-light">
                <input
                  type="checkbox"
                  checked={autoRecordEnabled}
                  onChange={handleToggleAutoRecord}
                  className="accent-aura-coral rounded"
                />
                <span>Auto-Record on Join</span>
              </label>

              <select
                aria-label="Meeting platform to detect"
                value={selectedPlatform}
                onChange={(e) => setSelectedPlatform(e.target.value as "meet" | "zoom" | "teams")}
                className="px-2.5 py-1.5 rounded-xl bg-white border border-aura-pastel text-xs font-semibold text-aura-charcoal btn-3d-light"
              >
                <option value="meet">Google Meet</option>
                <option value="zoom">Zoom Web</option>
                <option value="teams">Microsoft Teams</option>
              </select>

              <button
                type="button"
                onClick={handleSimulateDetect}
                disabled={detecting}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-aura-peach to-aura-coral btn-3d disabled:opacity-60"
              >
                <Radio className="w-3.5 h-3.5" />
                <span>{detecting ? "Detecting Call..." : "Detect / Simulate Live Call"}</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pt-1">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-aura-charcoal tracking-tight">
                Join a call, AURA takes it from there
              </h1>
              <p className="text-xs text-aura-slate mt-1 max-w-2xl">
                Add the AURA-MEET Chrome Extension to automatically capture live Google Meet, Zoom, and Teams calls. Every processed session updates your Transcript, Executive Summary, Personal Communication Coach, and Individual Commitment Dossiers.
              </p>
            </div>

            {/* Welcome Page Chrome Extension Download Action */}
            <a
              href={api.getExtensionDownloadUrl()}
              download="aura-meet-chrome-extension.zip"
              onClick={handleExtensionDownloadNotice}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold text-aura-charcoal bg-white border border-aura-peach hover:bg-aura-mist btn-3d-light whitespace-nowrap self-start lg:self-center"
              title="Download the AURA-MEET Chrome Extension (.zip) to load in chrome://extensions"
            >
              <Puzzle className="w-4 h-4 text-aura-coral" />
              <span>Download Chrome Extension (.zip)</span>
              <Download className="w-3.5 h-3.5 text-aura-coral" />
            </a>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            <Step
              icon={<Chrome className="w-4 h-4" />}
              title="1 · Add Extension & Auto-Detect"
              text="Download the Chrome Extension (.zip), load it in chrome://extensions, and AURA automatically detects active Meet, Zoom, and Teams calls."
            />
            <Step
              icon={<MousePointerClick className="w-4 h-4" />}
              title="2 · Stereo 16kHz Recording"
              text="Records your microphone (ME) on the left channel and remote participants on the right channel into a dedicated session folder."
            />
            <Step
              icon={<Sparkles className="w-4 h-4" />}
              title="3 · Full AI Processing Pipeline"
              text="When the call ends, Whisper transcribes and Gemma updates your Summary, To-Dos, Behavioral Coach, and People Dossiers."
            />
          </div>
        </div>
      )}

      {processingNow.length > 0 && (
        <div className="rounded-3xl bg-white/85 border border-indigo-100 p-5 space-y-3 card-3d scroll-reveal">
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
      <div className="rounded-3xl bg-white/85 border border-aura-pastel/80 p-4 sm:p-5 card-3d scroll-reveal">
        <div className="flex items-center justify-between px-3 pb-3">
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
    <div className="p-4 rounded-2xl bg-white/90 border border-aura-pastel/80 pop-hover">
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
    <div className="p-3 rounded-2xl bg-white/90 border border-aura-pastel/60 pop-hover">
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
