"use client";

import React, { useState } from "react";
import {
  Puzzle,
  Download,
  Radio,
  Cpu,
  UserCheck,
  Users,
  Trash2,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  X,
  Compass,
} from "lucide-react";
import { api } from "@/lib/api";

interface OnboardingTourModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const TOUR_STEPS = [
  {
    badge: "Step 1 of 6 · Required Browser Extension",
    title: "Add the Quorum Chrome Extension to Your Browser",
    icon: Puzzle,
    summary:
      "Quorum records meetings through its Chrome extension. Download it here, on the Home page, or anytime from the left sidebar — the download is always built from the latest code.",
    bullets: [
      "Click 'Download Chrome Extension (.zip)' below (or in the left sidebar) and unzip the archive on your computer.",
      "Open chrome://extensions in Chrome, Brave, or Edge and toggle on 'Developer mode' in the top-right corner.",
      "Click 'Load unpacked' and select the unzipped quorum-extension folder — it immediately connects to Quorum!",
    ],
    highlight:
      "After installing, right-click the Quorum toolbar icon and choose 'Session settings…' to set your name, models and recording behaviour.",
    showExtensionDownload: true,
  },
  {
    badge: "Step 2 of 6 · Recording",
    title: "You Start and Stop Every Recording",
    icon: Radio,
    summary:
      "Nothing is recorded until you say so. Open the meeting tab, click the Quorum icon and press Start recording — each recording becomes its own session.",
    bullets: [
      "Works with any tab that plays audio: Google Meet, Zoom web, Teams, or a recorded call.",
      "Captures 16kHz stereo audio: left channel = your microphone, right channel = the meeting tab.",
      "Stop from the side panel, the dashboard or ⌥⇧R; transcription and the summary start right after.",
    ],
    highlight:
      "Shortcut: ⌥⇧R starts or stops recording the current tab. Right-click the Quorum icon for session settings.",
    showExtensionDownload: false,
  },
  {
    badge: "Step 3 of 6 · Local Whisper ASR",
    title: "Downloaded Whisper ASR Models & On-Device Transcription",
    icon: Cpu,
    summary:
      "When a session is processed, Faster-Whisper transcribes the recording locally with timestamped speaker attribution.",
    bullets: [
      "In Settings → Whisper ASR Model, the selector shows only your downloaded models so transcription never fails offline.",
      "Models that are not yet installed clearly display 'Not Downloaded' with a one-click 'Download Model' button.",
      "Choose between Whisper Large-v3-Turbo (fast & recommended), Base, Small, Medium, or Large-v3.",
    ],
    highlight:
      "Visit Settings to inspect downloaded Whisper models or download new ones on demand.",
    showExtensionDownload: false,
  },
  {
    badge: "Step 4 of 6 · Behavioral Coach",
    title: "Personal Communication & Negotiation Coach (Runs Every Session)",
    icon: UserCheck,
    summary:
      "Every time you process a meeting session, Quorum audits your spoken lines (ME) and updates your Personal Communication & Negotiation Coach.",
    bullets: [
      "Tracks longitudinal Clarity Score, Listening/Empathy Ratio, Filler Words per Minute, and Talk Time.",
      "Detects hedging ('probably', 'I think'), defensive pushback, or passive concessions in your statements.",
      "Generates side-by-side Tactical Response Upgrades showing what you said vs. executive-grade wording.",
    ],
    highlight:
      "Open the 'Behavioral Coach' tab after processing any session to review your latest phrase audits.",
    showExtensionDownload: false,
  },
  {
    badge: "Step 5 of 6 · People Dossiers",
    title: "Individual Conversation & Commitment Dossier (Runs Every Session)",
    icon: Users,
    summary:
      "Every time you process a meeting session, Quorum automatically builds and updates a 1-on-1 Relationship Dossier for every named participant.",
    bullets: [
      "Extracts Cross-Meeting Promises & Commitments: what each colleague promised you vs. what you promised them.",
      "Aggregates chronological verbatim spoken quotes with [HH:MM:SS] timestamps across all meetings.",
      "Synthesizes an AI Communication Cheat Sheet and reliability score tailored to each person.",
    ],
    highlight:
      "Open the 'People' tab to browse colleague dossiers, commitments, and private strategic notes.",
    showExtensionDownload: false,
  },
  {
    badge: "Step 6 of 6 · Storage & Cleanup",
    title: "Complete Local File Storage & Clean Deletion",
    icon: Trash2,
    summary:
      "Every session stores its own audio.wav and meeting_notes.md on disk—and deleting anything in the UI physically deletes its files from storage.",
    bullets: [
      "Deleting a meeting session removes its database records AND deletes its folder, .wav audio, and .md notes from disk.",
      "Deleting an individual dossier or removing a downloaded Whisper model cleans up its corresponding storage files.",
      "Using 'Reset All Data to Completely Empty' in Settings wipes all session records and storage directories clean.",
    ],
    highlight:
      "You can re-open this interactive guide anytime using the 'Website Tour' button in the top bar.",
    showExtensionDownload: false,
  },
];

export default function OnboardingTourModal({ isOpen, onClose }: OnboardingTourModalProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [downloadedNotice, setDownloadedNotice] = useState(false);

  if (!isOpen) return null;

  const current = TOUR_STEPS[stepIndex];
  const Icon = current.icon;
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  const handleFinish = () => {
    setStepIndex(0);
    onClose();
  };

  const handleDownloadClick = () => {
    setDownloadedNotice(true);
    setTimeout(() => setDownloadedNotice(false), 5000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-brand-charcoal/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-tour-title"
    >
      <div className="w-full max-w-2xl rounded-3xl bg-white border border-brand-pastel shadow-2xl overflow-hidden card-3d">
        {/* Top Progress Header */}
        <div className="bg-gradient-to-r from-brand-mist via-white to-brand-mist px-6 py-4 border-b border-brand-pastel flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-brand-peach to-brand-coral text-white flex items-center justify-center shadow-peach-sm">
              <Compass className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-brand-coral block">
                Welcome to Quorum · Interactive Guide
              </span>
              <span className="text-xs font-extrabold text-brand-charcoal">
                {current.badge}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={api.getExtensionDownloadUrl()}
              download
              onClick={handleDownloadClick}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold text-brand-coral bg-white border border-brand-pastel hover:bg-brand-mist btn-3d-light"
              title="Download the Quorum Chrome Extension (.zip)"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Extension</span>
            </a>

            <button
              type="button"
              onClick={handleFinish}
              aria-label="Close website tour"
              className="p-1.5 rounded-xl text-brand-slate hover:text-brand-charcoal hover:bg-white border border-transparent hover:border-brand-pastel transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Step Progress Dots */}
        <div className="px-6 pt-4 flex items-center gap-2">
          {TOUR_STEPS.map((s, idx) => (
            <button
              key={s.title}
              type="button"
              onClick={() => setStepIndex(idx)}
              aria-label={`Go to tour step ${idx + 1}`}
              className={`h-2 rounded-full transition-all ${
                idx === stepIndex
                  ? "w-10 bg-gradient-to-r from-brand-peach to-brand-coral"
                  : idx < stepIndex
                  ? "w-4 bg-brand-peach/60"
                  : "w-4 bg-brand-mist border border-brand-pastel"
              }`}
            />
          ))}
        </div>

        {/* Main Content */}
        <div className="p-6 space-y-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-brand-mist text-brand-coral border border-brand-pastel flex items-center justify-center flex-shrink-0 pop-hover">
              <Icon className="w-6 h-6" />
            </div>
            <div>
              <h2
                id="onboarding-tour-title"
                className="text-xl font-extrabold text-brand-charcoal tracking-tight"
              >
                {current.title}
              </h2>
              <p className="text-xs text-brand-slate leading-relaxed mt-1">
                {current.summary}
              </p>
            </div>
          </div>

          <div className="rounded-2xl bg-brand-mist/40 border border-brand-pastel/80 p-4 space-y-2.5 pop-hover">
            {current.bullets.map((b, i) => (
              <div key={i} className="flex items-start gap-2.5 text-xs text-brand-charcoal">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                <span className="leading-relaxed font-medium">{b}</span>
              </div>
            ))}
          </div>

          {/* Dedicated Extension Download Callout on Step 1 */}
          {current.showExtensionDownload && (
            <div className="rounded-2xl bg-gradient-to-r from-brand-mist via-white to-amber-50/70 border border-brand-peach/80 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 pop-hover">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 text-xs font-extrabold text-brand-charcoal">
                  <Puzzle className="w-4 h-4 text-brand-coral" />
                  <span>Quorum Chrome Extension (Manifest V3)</span>
                </div>
                <p className="text-[11px] text-brand-slate">
                  Includes <code className="font-mono text-brand-charcoal">manifest.json</code>, the stereo 16kHz recorder and the side panel. Always built from the latest code.
                </p>
              </div>

              <a
                href={api.getExtensionDownloadUrl()}
                download
                onClick={handleDownloadClick}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-brand-peach to-brand-coral btn-3d whitespace-nowrap"
              >
                <Download className="w-4 h-4" />
                <span>Download Chrome Extension (.zip)</span>
              </a>
            </div>
          )}

          {downloadedNotice && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2 text-xs font-semibold text-emerald-900 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>
                Downloading <strong>the Quorum extension .zip</strong>! Unzip it and load it via <code className="font-mono">chrome://extensions</code> → Load unpacked.
              </span>
            </div>
          )}

          <div className="rounded-2xl bg-amber-50/80 border border-amber-200 px-4 py-3 flex items-center gap-2.5 text-xs text-amber-950 pop-hover">
            <Sparkles className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <span className="font-semibold">{current.highlight}</span>
          </div>
        </div>

        {/* Footer Controls */}
        <div className="px-6 py-4 bg-brand-mist/30 border-t border-brand-border flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleFinish}
            className="text-xs font-bold text-brand-slate hover:text-brand-charcoal px-3 py-1.5 rounded-xl hover:bg-white transition-colors"
          >
            Skip Tour
          </button>

          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-brand-charcoal bg-white border border-brand-pastel hover:bg-brand-mist btn-3d-light"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Previous</span>
              </button>
            )}

            {!isLast ? (
              <button
                type="button"
                onClick={() => setStepIndex((i) => Math.min(TOUR_STEPS.length - 1, i + 1))}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-brand-peach to-brand-coral btn-3d"
              >
                <span>Next Step</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleFinish}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 btn-3d"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Get Started with Quorum</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
