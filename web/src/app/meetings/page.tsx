"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { api, Meeting } from "@/lib/api";
import { useLiveEvents } from "@/lib/useLiveEvents";
import SessionList, { SessionProgress } from "@/components/SessionList";

export default function MeetingsIndexPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [progress, setProgress] = useState<Record<string, SessionProgress>>({});
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setMeetings(await api.getMeetings());
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useLiveEvents((ev) => {
    const id = ev.meeting_id;
    if (!id) return;
    if (ev.type === "PROCESSING_PROGRESS") {
      setProgress((prev) => ({ ...prev, [id]: { progress: ev.progress, message: ev.message } }));
    } else if (["MEETING_PROCESSED", "PROCESSING_ERROR", "RECORDING_STARTED", "RECORDING_STOPPED"].includes(ev.type)) {
      setProgress((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      refresh();
    }
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? meetings.filter((m) => m.title.toLowerCase().includes(q)) : meetings;
  }, [meetings, query]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this session, its audio and its notes?")) return;
    await api.deleteMeeting(id);
    refresh();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-aura-charcoal tracking-tight">Sessions</h1>
          <p className="text-xs text-aura-slate mt-1">{meetings.length} recorded meetings, each with its own audio, transcript and notes.</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-aura-pastel w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-aura-coral" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by title…"
            className="flex-1 text-xs bg-transparent focus:outline-none"
          />
        </div>
      </div>
      <div className="rounded-3xl bg-white/85 border border-aura-pastel/80 shadow-peach-sm p-3 sm:p-4">
        {loaded ? (
          <SessionList meetings={filtered} progress={progress} onDelete={handleDelete} />
        ) : (
          <div className="py-10 text-center text-xs text-aura-slate">Loading sessions…</div>
        )}
      </div>
    </div>
  );
}
