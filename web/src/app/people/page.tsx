"use client";

import React, { useState, useEffect } from "react";
import {
  Users,
  Search,
  Clock,
  CheckCircle2,
  BookOpen,
  MessageSquare,
  Sparkles,
  TrendingUp,
  ShieldCheck,
  Calendar,
  Save,
  User,
  ChevronRight,
  Trash2
} from "lucide-react";
import { api, IndividualProfile } from "@/lib/api";

export default function PeopleTrackerPage() {
  const [people, setPeople] = useState<IndividualProfile[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<IndividualProfile | null>(null);
  const [search, setSearch] = useState("");
  const [notesInput, setNotesInput] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const loadPeople = async () => {
    try {
      const list = await api.getIndividuals();
      setPeople(list);
      if (list.length > 0 && !selectedPerson) {
        loadDossier(list[0].id);
      }
    } catch (e) {
      console.warn("Could not load individuals:", e);
    }
  };

  const loadDossier = async (personId: string) => {
    try {
      const dossier = await api.getIndividual(personId);
      setSelectedPerson(dossier);
      setNotesInput(dossier.notes || "");
    } catch (e) {
      console.warn("Could not load individual dossier:", e);
    }
  };

  useEffect(() => {
    loadPeople();
  }, []);

  const handleSaveNotes = async () => {
    if (!selectedPerson) return;
    setSavingNotes(true);
    try {
      await api.updateIndividualNotes(selectedPerson.id, notesInput);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (e) {
      console.warn("Save note failed:", e);
    } finally {
      setSavingNotes(false);
    }
  };

  const handleDeletePerson = async (personId: string) => {
    try {
      await api.deleteIndividual(personId);
      const list = await api.getIndividuals();
      setPeople(list);
      if (list.length > 0) {
        loadDossier(list[0].id);
      } else {
        setSelectedPerson(null);
      }
    } catch (e) {
      console.warn("Delete individual failed:", e);
    }
  };

  const filteredPeople = people.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.role && p.role.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-3xl bg-white/85 backdrop-blur-md border border-brand-pastel/80 shadow-peach-md p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-brand-mist text-brand-coral border border-brand-pastel">
                1-on-1 Relationship Dossier
              </span>
              <span className="text-xs text-brand-slate font-medium">Longitudinal Memory Tracker</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-brand-charcoal tracking-tight">
              Individual Conversation & Commitment Dossier
            </h1>
            <p className="text-xs text-brand-slate mt-1 max-w-2xl leading-relaxed">
              Track longitudinal interactions, commitments made across meetings, and AI-synthesized communication playbooks for every colleague.
            </p>
          </div>

          <div className="relative min-w-[240px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people, roles..."
              className="w-full pl-9 pr-3.5 py-2 text-xs rounded-xl bg-brand-mist/60 border border-brand-pastel text-brand-charcoal focus:outline-none focus:border-brand-coral focus:bg-white shadow-inner"
            />
          </div>
        </div>
      </div>

      {/* Main Grid: Directory Column + Detailed Longitudinal Dossier */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: People Directory (Col 4) */}
        <div className="lg:col-span-4 rounded-3xl bg-white/85 backdrop-blur-md border border-brand-pastel/80 shadow-peach-sm p-4 space-y-2 max-h-[680px] overflow-y-auto">
          <div className="px-2 py-1 text-xs font-bold uppercase tracking-wider text-brand-slate">
            Directory ({filteredPeople.length})
          </div>

          {filteredPeople.length === 0 ? (
            <div className="p-8 text-center text-brand-slate text-xs space-y-1">
              <p className="font-bold text-brand-charcoal">No Colleagues Tracked</p>
              <p className="text-[11px]">Once meetings with participants are recorded, their dossiers appear here.</p>
            </div>
          ) : (
            filteredPeople.map((p) => {
            const isSelected = selectedPerson?.id === p.id;
            return (
              <div
                key={p.id}
                onClick={() => loadDossier(p.id)}
                className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between group ${
                  isSelected
                    ? "bg-gradient-to-r from-brand-mist to-white border-brand-peach shadow-peach-sm translate-x-1"
                    : "bg-white/80 border-brand-border hover:border-brand-pastel"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Initials name={p.name} className="w-10 h-10 rounded-full text-xs" />
                  <div className="min-w-0">
                    <div className="font-bold text-xs text-brand-charcoal truncate group-hover:text-brand-coral transition-colors">
                      {p.name}
                    </div>
                    <div className="text-[11px] text-brand-slate truncate">{p.role}</div>
                  </div>
                </div>

                <div className="flex flex-col items-end text-right flex-shrink-0">
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    {p.reliability_score}% Rel
                  </span>
                  <span className="text-[10px] text-brand-slate mt-1 font-medium">
                    {p.total_meetings} meetings
                  </span>
                </div>
              </div>
            );
          }))}
        </div>

        {/* Right: Detailed Longitudinal Dossier (Col 8) */}
        <div className="lg:col-span-8 rounded-3xl bg-white/85 backdrop-blur-md border border-brand-pastel/80 shadow-peach-sm p-6 space-y-6">
          {selectedPerson ? (
            <>
              {/* Profile Card Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-brand-border">
                <div className="flex items-center gap-4">
                  <Initials name={selectedPerson.name} className="w-14 h-14 rounded-2xl text-base shadow-peach-sm" />
                  <div>
                    <h2 className="text-xl font-extrabold text-brand-charcoal">
                      {selectedPerson.name}
                    </h2>
                    <p className="text-xs text-brand-slate font-medium">{selectedPerson.role}</p>
                    <p className="text-[11px] text-brand-slate/80">{selectedPerson.email}</p>
                  </div>
                </div>

                {/* Score Pills & Delete Dossier */}
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-brand-mist border border-brand-pastel text-center">
                    <span className="text-[10px] uppercase font-bold text-brand-slate block">Reliability</span>
                    <span className="text-base font-extrabold text-emerald-700">{selectedPerson.reliability_score}%</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-brand-mist border border-brand-pastel text-center">
                    <span className="text-[10px] uppercase font-bold text-brand-slate block">Total Meetings</span>
                    <span className="text-base font-extrabold text-brand-coral">{selectedPerson.total_meetings}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeletePerson(selectedPerson.id)}
                    aria-label={`Delete dossier for ${selectedPerson.name}`}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 transition-colors"
                    title="Delete individual dossier and storage record"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Dossier</span>
                  </button>
                </div>
              </div>

              {/* AI Communication Cheat Sheet */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-brand-mist/90 to-white border border-brand-peach/70 shadow-xs space-y-2">
                <div className="flex items-center gap-2 text-brand-coral font-bold text-xs uppercase tracking-wider">
                  <Sparkles className="w-4 h-4" />
                  <span>How to Communicate Effectively with {selectedPerson.name}</span>
                </div>
                <p className="text-xs font-semibold text-brand-charcoal leading-relaxed">
                  {selectedPerson.communication_cheat_sheet}
                </p>
              </div>

              {/* Promises & Commitments Tracker */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand-charcoal">
                  <ShieldCheck className="w-4 h-4 text-brand-coral" />
                  <span>Cross-Meeting Promises & Commitments</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {/* Promises by them */}
                  <div className="p-4 rounded-2xl bg-sky-50/70 border border-sky-200/80 space-y-2">
                    <span className="text-[11px] font-bold text-sky-900 uppercase tracking-wider block">
                      Promises {selectedPerson.name} Made to You:
                    </span>
                    {(selectedPerson.interactions || []).map((act: any, i: number) => (
                      <div key={i} className="text-xs text-sky-950 font-medium flex items-start gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-sky-600 flex-shrink-0 mt-0.5" />
                        <span>{act.promises_by_them || act.quote}</span>
                      </div>
                    ))}
                  </div>

                  {/* Promises by you */}
                  <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200/80 space-y-2">
                    <span className="text-[11px] font-bold text-amber-900 uppercase tracking-wider block">
                      Promises You Made to {selectedPerson.name}:
                    </span>
                    {(selectedPerson.interactions || []).map((act: any, i: number) => (
                      <div key={i} className="text-xs text-amber-950 font-medium flex items-start gap-2">
                        <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0 mt-1" />
                        <span>{act.promises_by_user || "—"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Chronological Spoken Quotes Across Meetings */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-brand-charcoal">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-brand-coral" />
                    <span>Verbatim Conversation History</span>
                  </div>
                  <span className="text-[11px] text-brand-slate font-medium">
                    {(selectedPerson.spoken_segments || []).length} quotes logged
                  </span>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {(selectedPerson.spoken_segments || []).map((seg: any) => (
                    <div
                      key={seg.id}
                      className="p-3 rounded-xl bg-white border border-brand-border text-xs leading-relaxed space-y-1"
                    >
                      <div className="flex items-center justify-between text-[10px] text-brand-slate">
                        <span className="font-semibold text-brand-charcoal">{seg.meeting_title || "Architecture Review"}</span>
                        <span className="font-mono text-brand-coral">[{seg.timestamp_badge}]</span>
                      </div>
                      <p className="text-brand-charcoal font-medium italic">"{seg.text}"</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Editable Private Notes */}
              <div className="pt-2 border-t border-brand-border space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-brand-charcoal uppercase tracking-wider">
                    Private Strategic Notes
                  </span>
                  <button
                    onClick={handleSaveNotes}
                    disabled={savingNotes}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-brand-peach to-brand-coral hover:opacity-90 transition-all shadow-xs"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{savingNotes ? "Saving..." : saveSuccess ? "Saved!" : "Save Notes"}</span>
                  </button>
                </div>
                <textarea
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  rows={3}
                  placeholder="Record working style observations, career goals, personal context..."
                  className="w-full p-3 text-xs rounded-xl border border-brand-pastel bg-brand-mist/40 text-brand-charcoal focus:outline-none focus:border-brand-coral focus:bg-white shadow-inner"
                />
              </div>
            </>
          ) : (
            <div className="text-center p-12 text-brand-slate text-xs space-y-1">
              <p className="font-bold text-brand-charcoal">
                {people.length === 0 ? "No Participants Tracked Yet" : "Select an Individual"}
              </p>
              <p className="text-[11px]">
                {people.length === 0
                  ? "People appear here once a processed meeting has a named speaker. Rename “Others” in a transcript to a person's name to start their dossier."
                  : "Click on any colleague from the directory to view their interaction history and communication cheat sheet."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Local initials instead of remote stock photos: no outside requests, no misleading faces
function Initials({ name, className = "" }: { name: string; className?: string }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <div className={`flex items-center justify-center flex-shrink-0 font-extrabold text-white bg-gradient-to-br from-brand-peach to-brand-coral ${className}`} aria-hidden>
      {letters || "?"}
    </div>
  );
}
