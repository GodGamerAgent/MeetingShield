"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Layers,
  ChevronDown,
  Plus,
  Trash2,
  Calendar,
  Volume2,
  Check,
  Search,
  X,
  Sparkles,
  Radio
} from "lucide-react";
import { api, Meeting } from "@/lib/api";

interface SessionSwitcherProps {
  currentMeetingId?: string;
  onSelectMeeting?: (id: string) => void;
}

export default function SessionSwitcher({ currentMeetingId, onSelectMeeting }: SessionSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);

  // New Meeting Form
  const [newTitle, setNewTitle] = useState("");
  const [newAgenda, setNewAgenda] = useState("");
  const [newAttendees, setNewAttendees] = useState("");
  const [creating, setCreating] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadMeetings = async () => {
    try {
      const list = await api.getMeetings();
      setMeetings(list);
    } catch (e) {
      console.warn("Could not load meetings:", e);
    }
  };

  useEffect(() => {
    loadMeetings();
  }, [currentMeetingId]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const activeMeeting = meetings.find((m) => m.id === currentMeetingId) || null;

  const handleSelect = (id: string) => {
    setIsOpen(false);
    if (onSelectMeeting) {
      onSelectMeeting(id);
    } else {
      router.push(`/meetings/${id}`);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await api.deleteMeeting(id);
      await loadMeetings();
      if (activeMeeting?.id === id) {
        const remaining = meetings.filter((m) => m.id !== id);
        if (remaining.length > 0) {
          handleSelect(remaining[0].id);
        } else {
          router.push("/");
        }
      }
    } catch (err) {
      console.warn("Failed to delete session:", err);
    }
  };

  const handleCreateMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const attendeesList = newAttendees.split(",").map((s) => s.trim()).filter(Boolean);
      const created = await api.createMeeting({
        title: newTitle.trim(),
        agenda: newAgenda.trim(),
        attendees: attendeesList
      });
      await loadMeetings();
      setIsNewModalOpen(false);
      setNewTitle("");
      setNewAgenda("");
      handleSelect(created.id);
    } catch (err) {
      console.warn("Failed to create session:", err);
    } finally {
      setCreating(false);
    }
  };

  const filteredMeetings = meetings.filter(
    (m) =>
      m.title.toLowerCase().includes(search.toLowerCase()) ||
      (m.agenda && m.agenda.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Active Session Button / Pill */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl border border-brand-pastel bg-white hover:bg-brand-mist/60 text-xs font-semibold text-brand-charcoal btn-3d-light"
        title="Switch between recorded sessions"
      >
        <div className="w-2 h-2 rounded-full bg-brand-coral flex-shrink-0" />
        <div className="flex flex-col text-left max-w-[170px] sm:max-w-[220px]">
          <span className="truncate leading-tight font-bold">
            {activeMeeting ? activeMeeting.title : "Jump to a session"}
          </span>
          <span className="text-[10px] text-brand-slate font-normal">
            {meetings.length} session{meetings.length === 1 ? "" : "s"} recorded
          </span>
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-brand-slate ml-1" />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute left-0 top-full mt-2 w-80 sm:w-96 rounded-2xl bg-white backdrop-blur-2xl border border-brand-pastel shadow-2xl ring-1 ring-brand-peach/30 p-3 z-[999]">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-brand-border">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand-charcoal">
              <Layers className="w-3.5 h-3.5 text-brand-coral" />
              <span>Switch Meeting Session</span>
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative mb-2.5">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-brand-slate" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sessions..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-brand-pastel/80 bg-brand-mist/40 text-brand-charcoal focus:outline-none focus:border-brand-coral shadow-inner"
            />
          </div>

          {/* Sessions List */}
          <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
            {filteredMeetings.length === 0 ? (
              <div className="text-center py-6 text-brand-slate text-xs space-y-2">
                <p className="font-semibold text-brand-charcoal">No sessions found.</p>
                <p className="text-[11px]">Sessions are created when you record a meeting with the extension.</p>
              </div>
            ) : (
              filteredMeetings.map((m) => {
                const isSelected = activeMeeting?.id === m.id;
                return (
                  <div
                    key={m.id}
                    onClick={() => handleSelect(m.id)}
                    className={`flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer group ${
                      isSelected
                        ? "bg-brand-mist/90 border-brand-peach shadow-xs"
                        : "bg-white border-brand-border/70 hover:border-brand-pastel hover:bg-brand-mist/30"
                    }`}
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-brand-charcoal truncate">
                          {m.title}
                        </span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-brand-coral flex-shrink-0" />}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-brand-slate mt-0.5">
                        <span suppressHydrationWarning className="flex items-center gap-1">
                          <Calendar className="w-2.5 h-2.5" />
                          {new Date(m.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                        </span>
                        {m.has_audio && (
                          <span className="flex items-center gap-0.5 text-emerald-700 bg-emerald-50 px-1 rounded border border-emerald-200">
                            <Volume2 className="w-2.5 h-2.5" /> WAV
                          </span>
                        )}
                        <span className="capitalize">{m.status}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => handleDelete(e, m.id)}
                      className="p-1.5 rounded-lg text-brand-slate hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      title="Delete Session"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

    </div>
  );
}
