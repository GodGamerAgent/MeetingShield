"use client";

import React from "react";
import Link from "next/link";
import { Trash2, Clock, Loader2, AlertTriangle, CheckCircle2, Radio, CircleDashed } from "lucide-react";
import { Meeting } from "@/lib/api";

export interface SessionProgress {
  progress: number;
  message: string;
}

interface SessionListProps {
  meetings: Meeting[];
  progress: Record<string, SessionProgress>;
  onDelete?: (id: string) => void;
}

export function formatDuration(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec.toString().padStart(2, "0")}s`;
  return `${sec}s`;
}

const PLATFORM_LABEL: Record<string, string> = { meet: "Google Meet", zoom: "Zoom", teams: "Teams", browser: "Browser tab" };

export function StatusBadge({ status, progress }: { status: string; progress?: SessionProgress }) {
  const effective = progress ? "processing" : status;
  const styles: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
    recording: { cls: "bg-rose-50 text-rose-700 border-rose-200", icon: <Radio className="w-3 h-3 animate-pulse" />, label: "Recording" },
    processing: {
      cls: "bg-indigo-50 text-indigo-700 border-indigo-200",
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
      label: progress ? `Processing ${progress.progress}%` : "Processing",
    },
    completed: { cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: <CheckCircle2 className="w-3 h-3" />, label: "Ready" },
    error: { cls: "bg-red-50 text-red-700 border-red-200", icon: <AlertTriangle className="w-3 h-3" />, label: "Failed" },
    recorded: { cls: "bg-amber-50 text-amber-800 border-amber-200", icon: <CircleDashed className="w-3 h-3" />, label: "Not processed" },
  };
  const s = styles[effective] || { cls: "bg-slate-50 text-slate-600 border-slate-200", icon: null, label: effective };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold border whitespace-nowrap ${s.cls}`}>
      {s.icon}
      {s.label}
    </span>
  );
}

export default function SessionList({ meetings, progress, onDelete }: SessionListProps) {
  if (meetings.length === 0) {
    return (
      <div className="text-center py-10 text-xs text-aura-slate">
        <p className="font-semibold text-aura-charcoal">No sessions yet</p>
        <p className="mt-1">Every meeting you record becomes its own session here.</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-aura-border/70">
      {meetings.map((m) => {
        const p = progress[m.id];
        return (
          <li key={m.id} className="group">
            <Link
              href={`/meetings/${m.id}`}
              className="flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-aura-mist/60 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-aura-charcoal truncate">{m.title}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-aura-slate mt-0.5">
                  <span suppressHydrationWarning>
                    {new Date(m.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </span>
                  {m.duration_sec > 0 && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDuration(m.duration_sec)}
                    </span>
                  )}
                  {m.platform && <span>{PLATFORM_LABEL[m.platform] || m.platform}</span>}
                </div>
                {p && (
                  <div className="mt-1.5 h-1 rounded-full bg-indigo-100 overflow-hidden max-w-xs">
                    <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${p.progress}%` }} />
                  </div>
                )}
              </div>
              <StatusBadge status={m.status} progress={p} />
              {onDelete && (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    onDelete(m.id);
                  }}
                  className="p-1.5 rounded-lg text-aura-slate opacity-0 group-hover:opacity-100 hover:text-rose-600 hover:bg-rose-50 transition-all"
                  title="Delete session"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
