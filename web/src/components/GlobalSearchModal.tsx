"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  X,
  Calendar,
  MessageSquare,
  CheckSquare,
  User,
  ExternalLink,
  Clock,
  Sparkles
} from "lucide-react";
import { api, GlobalSearchResult } from "@/lib/api";

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function GlobalSearchModal({ isOpen, onClose }: GlobalSearchModalProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
      setResults(null);
    }
  }, [isOpen]);

  // Global Cmd+K / Ctrl+K listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (isOpen) onClose();
        else {
          // Trigger open
        }
      }
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.globalSearch(query.trim());
        setResults(data);
      } catch (err) {
        console.warn("Global search error:", err);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  if (!isOpen) return null;

  const navigateTo = (url: string) => {
    onClose();
    router.push(url);
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-start justify-center pt-16 sm:pt-24 px-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="w-full max-w-2xl rounded-3xl bg-white/95 backdrop-blur-2xl border border-brand-pastel shadow-2xl overflow-hidden flex flex-col max-h-[80vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-brand-border bg-white/80">
          <Search className="w-5 h-5 text-brand-coral flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all meetings, transcripts, action items, people..."
            className="w-full text-sm font-medium text-brand-charcoal bg-transparent placeholder-brand-slate focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="p-1 rounded-lg hover:bg-brand-mist text-brand-slate hover:text-brand-charcoal"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <span className="hidden sm:inline-block px-2 py-0.5 text-[10px] font-mono font-bold text-brand-slate bg-brand-mist rounded border border-brand-pastel">
            ESC
          </span>
        </div>

        {/* Results Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {loading && (
            <div className="py-12 text-center text-xs text-brand-slate flex items-center justify-center gap-2">
              <Sparkles className="w-4 h-4 text-brand-coral animate-spin" />
              <span>Searching meeting intelligence...</span>
            </div>
          )}

          {!loading && !query && (
            <div className="py-12 text-center space-y-2 text-brand-slate">
              <p className="text-xs font-semibold text-brand-charcoal">Global Omnisearch Across All Sessions</p>
              <p className="text-[11px] max-w-sm mx-auto">
                Type any keyword, attendee name, decision, or spoken phrase to retrieve exact quotes and timestamps across your entire meeting history.
              </p>
            </div>
          )}

          {!loading && query && results && results.total_results === 0 && (
            <div className="py-12 text-center space-y-1.5 text-brand-slate">
              <p className="text-xs font-bold text-brand-charcoal">No results found for &quot;{query}&quot;</p>
              <p className="text-[11px]">Try searching by topic, participant name, or specific keywords.</p>
            </div>
          )}

          {!loading && results && results.total_results > 0 && (
            <>
              {/* 1. Meetings */}
              {results.meetings.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-brand-slate uppercase tracking-wider px-2">
                    <Calendar className="w-3.5 h-3.5 text-brand-coral" />
                    <span>Meeting Sessions ({results.meetings.length})</span>
                  </div>
                  <div className="space-y-1">
                    {results.meetings.map((m) => (
                      <div
                        key={m.id}
                        onClick={() => navigateTo(`/meetings/${m.id}`)}
                        className="p-3 rounded-2xl bg-white hover:bg-brand-mist/60 border border-brand-border/80 hover:border-brand-peach transition-all cursor-pointer flex items-center justify-between group shadow-xs"
                      >
                        <div className="space-y-0.5">
                          <p className="text-xs font-bold text-brand-charcoal group-hover:text-brand-coral transition-colors">
                            {m.title}
                          </p>
                          <p className="text-[11px] text-brand-slate line-clamp-1">
                            {m.agenda || "General session"}
                          </p>
                        </div>
                        <span className="text-[10px] text-brand-coral font-semibold flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          Open Session &rarr;
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 2. Spoken Quotes / Transcripts */}
              {results.transcripts.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-brand-slate uppercase tracking-wider px-2">
                    <MessageSquare className="w-3.5 h-3.5 text-brand-coral" />
                    <span>Spoken Quotes & Transcripts ({results.transcripts.length})</span>
                  </div>
                  <div className="space-y-1.5">
                    {results.transcripts.map((t, idx) => (
                      <div
                        key={idx}
                        onClick={() => navigateTo(`/meetings/${t.meeting_id}`)}
                        className="p-3 rounded-2xl bg-white hover:bg-brand-mist/60 border border-brand-border/80 hover:border-brand-peach transition-all cursor-pointer group shadow-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-brand-charcoal">
                              {t.speaker_name}
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-brand-mist text-brand-coral border border-brand-pastel">
                              {t.timestamp_badge}
                            </span>
                          </div>
                          <span className="text-[10px] text-brand-slate font-medium">
                            {t.meeting_title || "Meeting"}
                          </span>
                        </div>
                        <p className="text-xs text-brand-slate leading-relaxed font-normal">
                          &ldquo;{t.text}&rdquo;
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 3. Action Items */}
              {results.todos.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-brand-slate uppercase tracking-wider px-2">
                    <CheckSquare className="w-3.5 h-3.5 text-brand-coral" />
                    <span>Action Items ({results.todos.length})</span>
                  </div>
                  <div className="space-y-1">
                    {results.todos.map((todo) => (
                      <div
                        key={todo.id}
                        onClick={() => navigateTo(`/meetings/${todo.meeting_id}`)}
                        className="p-2.5 rounded-2xl bg-white hover:bg-brand-mist/60 border border-brand-border/80 hover:border-brand-peach transition-all cursor-pointer flex items-center justify-between shadow-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-brand-coral" />
                          <span className="text-xs font-semibold text-brand-charcoal">
                            {todo.task}
                          </span>
                        </div>
                        <span className="text-[10px] text-brand-slate font-medium">
                          Owner: <strong>{todo.owner}</strong> ({todo.meeting_title || "Session"})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 4. People */}
              {results.people.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-brand-slate uppercase tracking-wider px-2">
                    <User className="w-3.5 h-3.5 text-brand-coral" />
                    <span>People Dossiers ({results.people.length})</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {results.people.map((p) => (
                      <div
                        key={p.id}
                        onClick={() => navigateTo(`/people`)}
                        className="p-3 rounded-2xl bg-white hover:bg-brand-mist/60 border border-brand-border/80 hover:border-brand-peach transition-all cursor-pointer shadow-xs space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-brand-charcoal">{p.name}</span>
                          <span className="text-[10px] text-brand-slate">{p.total_meetings} calls</span>
                        </div>
                        <p className="text-[11px] text-brand-slate line-clamp-1">{p.role || "Colleague"}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-brand-mist/40 border-t border-brand-border flex items-center justify-between text-[11px] text-brand-slate">
          <span>Search across all local SQLite & FTS5 indexed meetings</span>
          <span className="font-semibold text-brand-charcoal">Press ESC to close</span>
        </div>
      </div>
    </div>
  );
}
