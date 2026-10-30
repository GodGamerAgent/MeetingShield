"use client";

import React, { useState, useEffect } from "react";
import {
  Mail,
  MessageSquare,
  Copy,
  Check,
  ExternalLink,
  X,
  Sparkles,
  Send
} from "lucide-react";
import { api, FollowupDraft } from "@/lib/api";

interface FollowUpDrafterModalProps {
  meetingId: string;
  meetingTitle?: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function FollowUpDrafterModal({
  meetingId,
  meetingTitle,
  isOpen,
  onClose
}: FollowUpDrafterModalProps) {
  const [format, setFormat] = useState<"email" | "slack">("email");
  const [draft, setDraft] = useState<FollowupDraft | null>(null);
  const [editedBody, setEditedBody] = useState("");
  const [subject, setSubject] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchDraft = async (fmt: "email" | "slack") => {
    if (!meetingId) return;
    setLoading(true);
    try {
      const data = await api.getFollowupDraft(meetingId, fmt);
      setDraft(data);
      setSubject(data.subject || `Recap: ${meetingTitle || "Meeting"}`);
      setEditedBody(data.body || "");
    } catch (err) {
      console.warn("Failed to draft followup:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && meetingId) {
      fetchDraft(format);
    }
  }, [isOpen, meetingId, format]);

  if (!isOpen) return null;

  const handleCopy = () => {
    const fullText = format === "email" ? `Subject: ${subject}\n\n${editedBody}` : editedBody;
    navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleOpenEmailClient = () => {
    if (draft?.mailto_link) {
      window.open(draft.mailto_link, "_blank");
    } else {
      const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(editedBody)}`;
      window.open(mailto, "_blank");
    }
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="w-full max-w-2xl rounded-3xl bg-white/98 backdrop-blur-2xl border border-aura-pastel shadow-2xl overflow-hidden flex flex-col max-h-[88vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-aura-border bg-white">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-aura-mist text-aura-coral flex items-center justify-center border border-aura-pastel">
              <Mail className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-aura-charcoal">
                One-Click Follow-Up Drafter
              </h2>
              <p className="text-[11px] text-aura-slate">
                Executive recap ready to send to attendees or Slack channel
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-aura-mist text-aura-slate hover:text-aura-charcoal transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Format Selector Tabs */}
        <div className="flex items-center gap-2 px-6 pt-4 pb-2 border-b border-aura-border/60 bg-aura-mist/30">
          <button
            onClick={() => setFormat("email")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              format === "email"
                ? "bg-white text-aura-charcoal border border-aura-peach shadow-xs"
                : "text-aura-slate hover:text-aura-charcoal"
            }`}
          >
            <Mail className="w-3.5 h-3.5 text-aura-coral" />
            <span>📧 Executive Email Recap</span>
          </button>

          <button
            onClick={() => setFormat("slack")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              format === "slack"
                ? "bg-white text-aura-charcoal border border-aura-peach shadow-xs"
                : "text-aura-slate hover:text-aura-charcoal"
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5 text-aura-coral" />
            <span>💬 Slack / Teams Markdown</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading ? (
            <div className="py-16 text-center text-xs text-aura-slate flex items-center justify-center gap-2">
              <Sparkles className="w-4 h-4 text-aura-coral animate-spin" />
              <span>Gemma 4 is synthesizing your follow-up draft...</span>
            </div>
          ) : (
            <>
              {format === "email" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-aura-charcoal">Subject Line:</label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full px-3.5 py-2 text-xs rounded-xl border border-aura-pastel bg-white text-aura-charcoal font-semibold shadow-xs focus:outline-none focus:border-aura-coral"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-aura-charcoal">
                    {format === "email" ? "Email Body (Editable):" : "Slack Channel Message (Editable):"}
                  </label>
                  <span className="text-[10px] text-aura-slate">Feel free to tweak text before sending</span>
                </div>
                <textarea
                  rows={12}
                  value={editedBody}
                  onChange={(e) => setEditedBody(e.target.value)}
                  className="w-full p-4 text-xs font-mono rounded-2xl border border-aura-pastel bg-aura-mist/30 text-aura-charcoal leading-relaxed shadow-inner focus:outline-none focus:border-aura-coral resize-none"
                />
              </div>
            </>
          )}
        </div>

        {/* Actions Footer */}
        <div className="px-6 py-4 bg-white border-t border-aura-border flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={handleCopy}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-xs ${
              copied
                ? "bg-emerald-600 text-white"
                : "bg-aura-mist hover:bg-white text-aura-charcoal border border-aura-pastel"
            }`}
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4 text-aura-coral" />}
            <span>{copied ? "Copied to Clipboard!" : "Copy to Clipboard"}</span>
          </button>

          {format === "email" ? (
            <button
              onClick={handleOpenEmailClient}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-aura-peach to-aura-coral hover:opacity-95 shadow-peach-sm transition-all"
            >
              <Send className="w-4 h-4 text-white" />
              <span>Open in Gmail / Mail App</span>
            </button>
          ) : (
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-aura-peach to-aura-coral hover:opacity-95 shadow-peach-sm transition-all"
            >
              <Copy className="w-4 h-4 text-white" />
              <span>Copy for Slack & Close</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
