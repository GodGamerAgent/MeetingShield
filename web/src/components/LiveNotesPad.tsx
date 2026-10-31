"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Edit3,
  Sparkles,
  Save,
  Check,
  Copy,
  FileDown,
  Layers,
  FolderOpen
} from "lucide-react";
import { api, MeetingNotes } from "@/lib/api";

interface LiveNotesPadProps {
  meetingId: string;
  initialRawNotes?: string;
  initialEnhancedNotes?: string;
  folderPath?: string;
  onOpenMarkdown?: () => void;
}

export default function LiveNotesPad({
  meetingId,
  initialRawNotes = "",
  initialEnhancedNotes = "",
  folderPath = "",
  onOpenMarkdown,
}: LiveNotesPadProps) {
  const [activeTab, setActiveTab] = useState<"raw" | "enhanced">("raw");
  const [rawNotes, setRawNotes] = useState(initialRawNotes);
  const [enhancedNotes, setEnhancedNotes] = useState(initialEnhancedNotes);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [localFolder, setLocalFolder] = useState(folderPath);
  const [notice, setNotice] = useState<string | null>(null);

  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setRawNotes(initialRawNotes);
    setEnhancedNotes(initialEnhancedNotes);
    setLocalFolder(folderPath);
    if (initialEnhancedNotes && !initialRawNotes) {
      setActiveTab("enhanced");
    }
  }, [initialRawNotes, initialEnhancedNotes, folderPath]);

  // Fetch latest notes when meetingId changes
  useEffect(() => {
    if (!meetingId) return;
    api.getMeetingNotes(meetingId)
      .then((data) => {
        if (data.raw_notes) setRawNotes(data.raw_notes);
        if (data.enhanced_notes) {
          setEnhancedNotes(data.enhanced_notes);
          if (!data.raw_notes) setActiveTab("enhanced");
        }
        if (data.folder_path) setLocalFolder(data.folder_path);
      })
      .catch(() => {});
  }, [meetingId]);

  // Debounced auto-save for raw notes
  const handleRawNotesChange = (text: string) => {
    setRawNotes(text);
    setSaveSuccess(false);

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (!meetingId) return;
      setSaving(true);
      try {
        await api.saveRawNotes(meetingId, text);
        setSaving(false);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
      } catch (e) {
        setSaving(false);
      }
    }, 1500);
  };

  const handleManualSave = async () => {
    if (!meetingId) return;
    setSaving(true);
    try {
      await api.saveRawNotes(meetingId, rawNotes);
      setSaving(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (e) {
      setSaving(false);
    }
  };

  const handleEnhance = async () => {
    if (!meetingId) return;
    setEnhancing(true);
    setNotice(null);
    try {
      await api.saveRawNotes(meetingId, rawNotes);
      const res = await api.enhanceNotes(meetingId, rawNotes);
      if (res.status === "llm_offline") {
        setNotice("LM Studio is offline. Start it and try again — your notes are saved.");
      } else if (res.status === "no_transcript") {
        setNotice("This session has no transcript yet. Process the meeting first, then enhance your notes.");
      } else {
        setEnhancedNotes(res.enhanced_notes);
        setActiveTab("enhanced");
      }
    } catch (err) {
      setNotice("Note enhancement notice: " + (err as Error).message);
    } finally {
      setEnhancing(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-3xl bg-white/85 backdrop-blur-md border border-aura-pastel/80 shadow-peach-sm p-5 space-y-4">
      {/* Header & Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-aura-border">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-aura-mist text-aura-coral border border-aura-pastel">
            <Edit3 className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-aura-charcoal">
              Granola-Style Live Notes Pad
            </h3>
            <p className="text-[11px] text-aura-slate">
              Jot rough bullets during call &rarr; click Enhance to correlate with transcript
            </p>
          </div>
        </div>

        {/* Tab switchers */}
        <div className="flex items-center gap-1.5 bg-aura-mist/60 p-1 rounded-xl border border-aura-pastel">
          <button
            onClick={() => setActiveTab("raw")}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              activeTab === "raw"
                ? "bg-white text-aura-charcoal shadow-xs border border-aura-pastel/70"
                : "text-aura-slate hover:text-aura-charcoal"
            }`}
          >
            My Raw Notes
          </button>
          <button
            onClick={() => setActiveTab("enhanced")}
            className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              activeTab === "enhanced"
                ? "bg-white text-aura-coral shadow-xs border border-aura-pastel/70"
                : "text-aura-slate hover:text-aura-coral"
            }`}
          >
            <Sparkles className="w-3 h-3 text-aura-coral" />
            <span>Enhanced Notes</span>
          </button>
        </div>
      </div>

      {/* Editor Content */}
      {activeTab === "raw" ? (
        <div className="space-y-3">
          <div className="relative">
            <textarea
              rows={8}
              value={rawNotes}
              onChange={(e) => handleRawNotesChange(e.target.value)}
              placeholder="Type your rough bullets or shorthand notes while the meeting progresses...&#10;• sarah: database migration done by Tuesday&#10;• fargate rejected due to 42% cost premium&#10;• marcus to finalize telemetry schema by Wednesday 3pm"
              className="w-full p-4 text-xs font-medium rounded-2xl border border-aura-pastel bg-white/90 text-aura-charcoal leading-relaxed shadow-inner focus:outline-none focus:border-aura-coral resize-none"
            />
            {saving && (
              <span className="absolute right-4 bottom-4 text-[10px] text-aura-slate bg-white/80 px-2 py-0.5 rounded shadow-xs">
                Saving...
              </span>
            )}
            {saveSuccess && (
              <span className="absolute right-4 bottom-4 text-[10px] text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded shadow-xs flex items-center gap-1">
                <Check className="w-3 h-3" />
                Saved to folder
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={handleManualSave}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-white text-aura-charcoal border border-aura-pastel hover:bg-aura-mist transition-all shadow-xs"
            >
              <Save className="w-3.5 h-3.5 text-aura-slate" />
              <span>Save Scratchpad</span>
            </button>

            <button
              type="button"
              disabled={enhancing || !rawNotes.trim()}
              onClick={handleEnhance}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-aura-peach to-aura-coral hover:opacity-95 shadow-peach-sm transition-all disabled:opacity-50"
            >
              <Sparkles className={`w-3.5 h-3.5 ${enhancing ? "animate-spin" : ""}`} />
              <span>{enhancing ? "Enhancing with Gemma 4..." : "✨ Enhance My Notes"}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="p-4 rounded-2xl border border-aura-pastel bg-white/95 text-xs text-aura-charcoal leading-relaxed space-y-2 max-h-[300px] overflow-y-auto whitespace-pre-wrap font-medium">
            {enhancedNotes ? (
              enhancedNotes
            ) : (
              <div className="text-center py-8 text-aura-slate space-y-2">
                <p className="font-semibold text-aura-charcoal">No Enhanced Notes Yet</p>
                <p className="text-[11px] max-w-sm mx-auto">
                  Switch to &quot;My Raw Notes&quot;, type a few thoughts or bullets, and click &quot;Enhance My Notes&quot; to correlate them with transcript timestamps.
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button
              type="button"
              disabled={!enhancedNotes}
              onClick={() => handleCopy(enhancedNotes)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-white text-aura-charcoal border border-aura-pastel hover:bg-aura-mist transition-all shadow-xs"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-aura-coral" />}
              <span>{copied ? "Copied!" : "Copy Enhanced Notes"}</span>
            </button>

            <button
              type="button"
              disabled={enhancing}
              onClick={handleEnhance}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold text-aura-coral bg-aura-mist border border-aura-pastel hover:bg-aura-peach hover:text-white transition-all shadow-xs"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Re-Enhance</span>
            </button>
          </div>
        </div>
      )}

      {notice && (
        <div className="px-3.5 py-2 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 font-medium">
          {notice}
        </div>
      )}

      {/* Per-meeting Folder Disk Location Badge */}
      {meetingId && (
        <div className="pt-2 border-t border-aura-border/60 flex flex-wrap items-center justify-between text-[11px] text-aura-slate gap-2">
          <span className="flex items-center gap-1.5 font-medium">
            <FolderOpen className="w-3.5 h-3.5 text-aura-coral flex-shrink-0" />
            <span className="truncate max-w-xs sm:max-w-md">
              Folder: <code className="text-aura-charcoal bg-aura-mist px-1.5 py-0.5 rounded font-mono text-[10.5px]">{localFolder || `/tmp/aura-recordings/${meetingId}`}</code>
            </span>
          </span>
          <button
            type="button"
            onClick={() => onOpenMarkdown?.()}
            className="font-bold text-aura-coral hover:underline flex items-center gap-1 text-[11px]"
          >
            <Layers className="w-3 h-3" />
            <span>Open meeting_notes.md (GitHub &amp; Obsidian Viewer)</span>
          </button>
        </div>
      )}
    </div>
  );
}
