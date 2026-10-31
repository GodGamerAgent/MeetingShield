"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Mail,
  MessageSquare,
  Copy,
  Check,
  X,
  Sparkles,
  Send,
  Eye,
  Edit3,
  CheckCircle2,
  ListChecks,
  Users,
  FileText,
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
  onClose,
}: FollowUpDrafterModalProps) {
  const [mounted, setMounted] = useState(false);
  const [format, setFormat] = useState<"email" | "slack">("email");
  const [viewMode, setViewMode] = useState<"split" | "preview" | "edit">("split");
  const [draft, setDraft] = useState<FollowupDraft | null>(null);
  const [editedBody, setEditedBody] = useState("");
  const [subject, setSubject] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchDraft = async (fmt: "email" | "slack") => {
    if (!meetingId) return;
    setLoading(true);
    try {
      const data = await api.getFollowupDraft(meetingId, fmt);
      setDraft(data);
      setSubject(data.subject || `Recap & Action Items: ${meetingTitle || "Meeting"}`);
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

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen || !mounted) return null;

  const handleCopy = () => {
    const fullText =
      format === "email" ? `Subject: ${subject}\n\n${editedBody}` : editedBody;
    navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const mailtoUrl =
    draft?.mailto_link ||
    `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(editedBody)}`;

  const renderInlineSlackOrEmail = (line: string) => {
    // Convert :emoji: shortcodes and *bold* or **bold** into clean readable UI
    const normalized = line
      .replace(/:memo:/g, "📝")
      .replace(/:bulb:/g, "💡")
      .replace(/:white_check_mark:/g, "✅")
      .replace(/:dart:/g, "🎯");

    const parts = normalized.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\[\d{2}:\d{2}:\d{2}\])/g);
    return parts.map((part, idx) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={idx} className="font-bold text-[#2B2129]">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
        return (
          <strong key={idx} className="font-bold text-[#2B2129]">
            {part.slice(1, -1)}
          </strong>
        );
      }
      if (/^\[\d{2}:\d{2}:\d{2}\]$/.test(part)) {
        return (
          <span
            key={idx}
            className="inline-block font-mono text-xs font-bold px-1.5 py-0.5 rounded-md bg-[#FFF4EE] text-[#FF7F50] border border-[#FFD8C7] mx-0.5"
          >
            {part}
          </span>
        );
      }
      return <span key={idx}>{part}</span>;
    });
  };

  const modalNode = (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center p-3 sm:p-6 bg-[#2B2129]/65 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="followup-modal-title"
    >
      <div
        className="w-full max-w-4xl rounded-3xl bg-white border-2 border-[#FFD8C7] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        style={{ backgroundColor: "#FFFFFF", color: "#2B2129" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Solid High-Contrast Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F5E6DF] bg-gradient-to-r from-[#FFF4EE] via-white to-[#FFF4EE]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#FF7F50] text-white flex items-center justify-center shadow-sm">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2
                  id="followup-modal-title"
                  className="text-base sm:text-lg font-extrabold text-[#2B2129] tracking-tight"
                >
                  One-Click Follow-Up Drafter
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#FFF4EE] text-[#FF7F50] border border-[#FFD8C7]">
                  Gemma 4 Synthesis
                </span>
              </div>
              <p className="text-xs font-medium text-[#5C4E58] mt-0.5">
                Executive recap &amp; action items ready for attendees or Slack / Teams channels
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close follow-up dialog"
            className="p-2 rounded-xl bg-[#FFF4EE] hover:bg-[#FFD8C7] text-[#2B2129] transition-colors border border-[#FFD8C7]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Format & View Mode Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-[#F5E6DF] bg-[#FFFDFB]">
          {/* Channel Format Selector */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFormat("email")}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-extrabold transition-all ${
                format === "email"
                  ? "bg-[#2B2129] text-white shadow-sm"
                  : "bg-[#FFF4EE] text-[#2B2129] hover:bg-[#FFD8C7]/60 border border-[#FFD8C7]"
              }`}
            >
              <Mail className="w-3.5 h-3.5 text-[#FF9E7D]" />
              <span>Executive Email Recap</span>
            </button>

            <button
              type="button"
              onClick={() => setFormat("slack")}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-extrabold transition-all ${
                format === "slack"
                  ? "bg-[#2B2129] text-white shadow-sm"
                  : "bg-[#FFF4EE] text-[#2B2129] hover:bg-[#FFD8C7]/60 border border-[#FFD8C7]"
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 text-[#FF9E7D]" />
              <span>Slack / Teams Markdown</span>
            </button>
          </div>

          {/* Readability Mode Switcher */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#FFF4EE] border border-[#FFD8C7]">
            <button
              type="button"
              onClick={() => setViewMode("split")}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                viewMode === "split"
                  ? "bg-white text-[#2B2129] shadow-xs border border-[#FFD8C7]"
                  : "text-[#5C4E58] hover:text-[#2B2129]"
              }`}
            >
              Split View
            </button>
            <button
              type="button"
              onClick={() => setViewMode("preview")}
              className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                viewMode === "preview"
                  ? "bg-white text-[#2B2129] shadow-xs border border-[#FFD8C7]"
                  : "text-[#5C4E58] hover:text-[#2B2129]"
              }`}
            >
              <Eye className="w-3.5 h-3.5 text-[#FF7F50]" />
              <span>Formatted Reader</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("edit")}
              className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                viewMode === "edit"
                  ? "bg-white text-[#2B2129] shadow-xs border border-[#FFD8C7]"
                  : "text-[#5C4E58] hover:text-[#2B2129]"
              }`}
            >
              <Edit3 className="w-3.5 h-3.5 text-[#FF7F50]" />
              <span>Edit Text</span>
            </button>
          </div>
        </div>

        {/* Main Content Body (100% Solid Background for Maximum Readability) */}
        <div className="flex-1 overflow-y-auto p-6 bg-white space-y-4">
          {loading ? (
            <div className="py-16 text-center text-sm font-semibold text-[#2B2129] flex flex-col items-center justify-center gap-3">
              <Sparkles className="w-6 h-6 text-[#FF7F50] animate-spin" />
              <span>Gemma 4 is synthesizing your follow-up draft...</span>
            </div>
          ) : (
            <>
              {format === "email" && (
                <div className="p-4 rounded-2xl bg-[#FFFDFB] border-2 border-[#FFD8C7] space-y-1.5">
                  <label className="text-xs font-extrabold uppercase tracking-wider text-[#5C4E58] block">
                    Email Subject Line
                  </label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm sm:text-base rounded-xl border border-[#FFD8C7] bg-white text-[#2B2129] font-bold shadow-xs focus:outline-none focus:border-[#FF7F50]"
                  />
                </div>
              )}

              <div
                className={`grid gap-5 ${
                  viewMode === "split" ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"
                }`}
              >
                {/* Formatted High-Contrast Reader Card */}
                {(viewMode === "split" || viewMode === "preview") && (
                  <div className="rounded-2xl border-2 border-[#FFD8C7] bg-[#FFFDFB] overflow-hidden flex flex-col">
                    <div className="px-4 py-2.5 bg-[#FFF4EE] border-b border-[#FFD8C7] flex items-center justify-between">
                      <span className="text-xs font-extrabold text-[#2B2129] flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-[#FF7F50]" />
                        Formatted Read-Through Preview
                      </span>
                      <span className="text-[11px] font-semibold text-[#5C4E58]">
                        {format === "email" ? "Executive Email" : "Slack / Teams Block"}
                      </span>
                    </div>
                    <div className="p-5 space-y-2.5 text-sm text-[#2B2129] leading-relaxed overflow-y-auto max-h-[420px]">
                      {format === "email" && (
                        <div className="pb-3 mb-3 border-b border-[#F5E6DF]">
                          <div className="text-xs font-semibold text-[#5C4E58]">
                            Subject:{" "}
                            <span className="font-extrabold text-[#2B2129]">{subject}</span>
                          </div>
                        </div>
                      )}
                      {editedBody.split("\n").map((line, i) => {
                        const trimmed = line.trim();
                        if (!trimmed) {
                          return <div key={i} className="h-2" />;
                        }
                        if (
                          trimmed === "Summary:" ||
                          trimmed === "Decisions:" ||
                          trimmed === "Action Items:" ||
                          trimmed.startsWith(":white_check_mark:") ||
                          trimmed.startsWith(":dart:") ||
                          trimmed.startsWith(":bulb:") ||
                          trimmed.startsWith(":memo:")
                        ) {
                          return (
                            <div
                              key={i}
                              className="pt-2 font-extrabold text-[#2B2129] text-sm border-b border-[#F5E6DF]/80 pb-1"
                            >
                              {renderInlineSlackOrEmail(trimmed)}
                            </div>
                          );
                        }
                        if (trimmed.startsWith("•") || trimmed.startsWith("-")) {
                          return (
                            <div
                              key={i}
                              className="flex items-start gap-2.5 pl-2 py-1 text-sm text-[#2B2129]"
                            >
                              <span className="w-2 h-2 rounded-full bg-[#FF7F50] mt-2 flex-shrink-0" />
                              <span className="leading-relaxed">
                                {renderInlineSlackOrEmail(trimmed.replace(/^[•-]\s*/, ""))}
                              </span>
                            </div>
                          );
                        }
                        return (
                          <p key={i} className="text-sm text-[#2B2129] leading-relaxed">
                            {renderInlineSlackOrEmail(line)}
                          </p>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Editable Textarea */}
                {(viewMode === "split" || viewMode === "edit") && (
                  <div className="rounded-2xl border-2 border-[#FFD8C7] bg-white overflow-hidden flex flex-col">
                    <div className="px-4 py-2.5 bg-[#FFF4EE] border-b border-[#FFD8C7] flex items-center justify-between">
                      <label
                        htmlFor="followup-body-editor"
                        className="text-xs font-extrabold text-[#2B2129] flex items-center gap-1.5"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-[#FF7F50]" />
                        {format === "email"
                          ? "Editable Email Body"
                          : "Editable Slack / Teams Message"}
                      </label>
                      <span className="text-[11px] font-medium text-[#5C4E58]">
                        Live synced with preview
                      </span>
                    </div>
                    <textarea
                      id="followup-body-editor"
                      rows={14}
                      value={editedBody}
                      onChange={(e) => setEditedBody(e.target.value)}
                      className="w-full flex-1 p-4 text-sm font-medium bg-white text-[#2B2129] leading-relaxed focus:outline-none resize-none"
                      style={{ color: "#2B2129", backgroundColor: "#FFFFFF" }}
                    />
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Solid Footer Actions */}
        <div className="px-6 py-4 bg-[#FFF4EE] border-t border-[#FFD8C7] flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleCopy}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-extrabold transition-all shadow-xs ${
              copied
                ? "bg-emerald-600 text-white"
                : "bg-white hover:bg-[#FFFDFB] text-[#2B2129] border-2 border-[#FFD8C7]"
            }`}
          >
            {copied ? (
              <Check className="w-4 h-4" />
            ) : (
              <Copy className="w-4 h-4 text-[#FF7F50]" />
            )}
            <span>{copied ? "Copied to Clipboard!" : "Copy Full Message"}</span>
          </button>

          <div className="flex items-center gap-2.5">
            {format === "email" ? (
              <a
                href={mailtoUrl}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-extrabold text-white bg-gradient-to-r from-[#FF9E7D] to-[#FF7F50] hover:opacity-95 shadow-sm transition-all"
              >
                <Send className="w-4 h-4 text-white" />
                <span>Open in Default Mail App</span>
              </a>
            ) : (
              <button
                type="button"
                onClick={() => {
                  handleCopy();
                  setTimeout(onClose, 600);
                }}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-extrabold text-white bg-gradient-to-r from-[#FF9E7D] to-[#FF7F50] hover:opacity-95 shadow-sm transition-all"
              >
                <Copy className="w-4 h-4 text-white" />
                <span>Copy for Slack &amp; Close</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalNode, document.body);
}
