"use client";

import React, { useState, useEffect } from "react";
import { X, Calendar, Download, ExternalLink, Check, Copy } from "lucide-react";
import { api } from "@/lib/api";

interface CalendarModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskTitle: string;
  deadline?: string;
  description?: string;
}

export default function CalendarModal({
  isOpen,
  onClose,
  taskTitle,
  deadline,
  description = ""
}: CalendarModalProps) {
  const [loading, setLoading] = useState(false);
  const [calData, setCalData] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen && taskTitle) {
      setLoading(true);
      api.exportCalendar({
        title: taskTitle,
        deadline: deadline,
        description: description
      })
      .then(res => {
        setCalData(res);
      })
      .catch(err => {
        console.error("Failed to generate calendar links:", err);
      })
      .finally(() => setLoading(false));
    }
  }, [isOpen, taskTitle, deadline, description]);

  if (!isOpen) return null;

  const handleDownloadIcs = () => {
    if (!calData?.ics_content) return;
    const blob = new Blob([calData.ics_content], { type: "text/calendar;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${taskTitle.slice(0, 24).replace(/[^a-zA-Z0-9]/g, "_")}.ics`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleCopyIcs = () => {
    if (calData?.ics_content) {
      navigator.clipboard.writeText(calData.ics_content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white p-6 shadow-2xl border border-brand-pastel/80">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-brand-border">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-brand-mist text-brand-coral border border-brand-pastel">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-brand-charcoal text-base">Universal Calendar Export</h3>
              <p className="text-xs text-brand-slate">Sync with your preferred calendar ecosystem</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-brand-slate hover:bg-brand-mist transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Task Details Preview */}
        <div className="mt-4 p-3.5 rounded-xl bg-brand-mist/60 border border-brand-pastel/60 text-xs">
          <span className="font-semibold text-brand-charcoal block mb-1">Event / Action Item:</span>
          <p className="text-brand-slate text-[13px] leading-relaxed font-medium">{taskTitle}</p>
          {deadline && (
            <div className="mt-2 flex items-center gap-1.5 text-brand-coral font-medium text-[11px]">
              <span>Deadline:</span>
              <span>{deadline}</span>
            </div>
          )}
        </div>

        {/* 3 Calendar Ecosystem Buttons */}
        <div className="mt-5 space-y-3">
          {/* 1. Google Calendar */}
          <a
            href={calData?.google_calendar_url || "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-3.5 rounded-xl border border-brand-border hover:border-brand-peach bg-white hover:bg-brand-mist/50 transition-all group"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 font-bold text-xs border border-blue-200">
                G
              </div>
              <div className="text-left">
                <div className="font-medium text-sm text-brand-charcoal group-hover:text-brand-coral transition-colors">
                  Google Calendar
                </div>
                <div className="text-[11px] text-brand-slate">Direct template deeplink</div>
              </div>
            </div>
            <ExternalLink className="w-4 h-4 text-brand-slate group-hover:text-brand-coral transition-colors" />
          </a>

          {/* 2. Microsoft Outlook */}
          <a
            href={calData?.outlook_web_url || "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-3.5 rounded-xl border border-brand-border hover:border-brand-peach bg-white hover:bg-brand-mist/50 transition-all group"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-sky-50 flex items-center justify-center text-sky-600 font-bold text-xs border border-sky-200">
                O
              </div>
              <div className="text-left">
                <div className="font-medium text-sm text-brand-charcoal group-hover:text-brand-coral transition-colors">
                  Microsoft Outlook (Web)
                </div>
                <div className="text-[11px] text-brand-slate">Office 365 compose deeplink</div>
              </div>
            </div>
            <ExternalLink className="w-4 h-4 text-brand-slate group-hover:text-brand-coral transition-colors" />
          </a>

          {/* 3. Apple Calendar / RFC-5545 .ics Download */}
          <button
            onClick={handleDownloadIcs}
            className="w-full flex items-center justify-between p-3.5 rounded-xl border border-brand-border hover:border-brand-peach bg-white hover:bg-brand-mist/50 transition-all group"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700 font-bold text-xs border border-slate-300">
                
              </div>
              <div className="text-left">
                <div className="font-medium text-sm text-brand-charcoal group-hover:text-brand-coral transition-colors">
                  Apple Calendar & iCal (.ics)
                </div>
                <div className="text-[11px] text-brand-slate">Universal RFC-5545 format</div>
              </div>
            </div>
            <Download className="w-4 h-4 text-brand-slate group-hover:text-brand-coral transition-colors" />
          </button>
        </div>

        {/* Footer Actions */}
        <div className="mt-5 pt-3 border-t border-brand-border flex items-center justify-between">
          <button
            onClick={handleCopyIcs}
            className="inline-flex items-center gap-1.5 text-xs text-brand-slate hover:text-brand-charcoal transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-brand-emerald" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? "Copied .ics text!" : "Copy Raw iCal Payload"}</span>
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-brand-mist text-brand-charcoal hover:bg-brand-pastel/60 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
