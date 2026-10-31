"use client";

import React, { useState, useEffect } from "react";
import {
  UserCheck,
  TrendingUp,
  AlertCircle,
  Sparkles,
  Clock,
  ArrowRight,
  ShieldAlert,
  Award,
  Zap,
  CheckCircle2,
  Filter
} from "lucide-react";
import { api, CoachingCard } from "@/lib/api";

export default function BehavioralCoachPage() {
  const [coachData, setCoachData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filterTone, setFilterTone] = useState<string>("ALL");

  useEffect(() => {
    api.getCoachData()
      .then(data => setCoachData(data))
      .catch(e => console.warn("Failed to load coach metrics:", e))
      .finally(() => setLoading(false));
  }, []);

  const metrics = coachData?.metrics || {
    clarity_score: 0,
    empathy_ratio: 0,
    filler_words_per_min: 0,
    talk_minutes: 0
  };

  const cards: CoachingCard[] = coachData?.cards || [];

  const filteredCards = cards.filter(c => {
    if (filterTone === "ALL") return true;
    return c.tone_detected.toLowerCase().includes(filterTone.toLowerCase());
  });

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-3xl bg-white/85 backdrop-blur-md border border-brand-pastel/80 shadow-peach-md p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-brand-mist text-brand-coral border border-brand-pastel">
                Behavioral & Response Coach
              </span>
              <span className="text-xs text-brand-slate font-medium">Based on your own lines in recorded meetings</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-brand-charcoal tracking-tight">
              Personal Communication & Negotiation Coach
            </h1>
            <p className="text-xs text-brand-slate mt-1 max-w-2xl leading-relaxed">
              Gemma 4 analyzes your spoken statements across meetings, detecting defensive tone, vague commitments, and missed leverage, providing word-for-word tactical response upgrades.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-brand-coral bg-brand-mist px-3.5 py-1.5 rounded-xl border border-brand-pastel shadow-xs">
              Longitudinal AI Audit Active
            </span>
          </div>
        </div>
      </div>

      {/* 4 Scorecard Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Clarity Score */}
        <div className="p-5 rounded-3xl bg-white/85 backdrop-blur-md border border-brand-pastel/80 shadow-peach-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-brand-slate block mb-1">
              Clarity Score
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-brand-charcoal">{metrics.clarity_score}</span>
              <span className="text-xs text-brand-slate">/ 100</span>
            </div>
            <span className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1 mt-1">
              <TrendingUp className="w-3.5 h-3.5" /> +4.2% vs last month
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-brand-mist text-brand-coral flex items-center justify-center border border-brand-pastel">
            <Award className="w-6 h-6" />
          </div>
        </div>

        {/* Metric 2: Empathy & Listening */}
        <div className="p-5 rounded-3xl bg-white/85 backdrop-blur-md border border-brand-pastel/80 shadow-peach-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-brand-slate block mb-1">
              Listening / Inquiry
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-brand-charcoal">{metrics.empathy_ratio}%</span>
            </div>
            <span className="text-[11px] text-brand-slate font-medium block mt-1">
              Healthy collaborative inquiry
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-200">
            <UserCheck className="w-6 h-6" />
          </div>
        </div>

        {/* Metric 3: Filler Words */}
        <div className="p-5 rounded-3xl bg-white/85 backdrop-blur-md border border-brand-pastel/80 shadow-peach-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-brand-slate block mb-1">
              Filler Words
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-brand-charcoal">{metrics.filler_words_per_min}</span>
              <span className="text-xs text-brand-slate">/ min</span>
            </div>
            <span className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1 mt-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Top 10% concise
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center border border-purple-200">
            <Zap className="w-6 h-6" />
          </div>
        </div>

        {/* Metric 4: Interruption Frequency */}
        <div className="p-5 rounded-3xl bg-white/85 backdrop-blur-md border border-brand-pastel/80 shadow-peach-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-brand-slate block mb-1">
              Your Talk Time
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-brand-charcoal">{metrics.talk_minutes ?? 0}</span>
              <span className="text-xs font-semibold text-brand-slate">min</span>
            </div>
            <span className="text-[11px] text-brand-slate font-medium block mt-1">
              Measured across all sessions
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-200">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Side-by-Side Response Upgrade Cards */}
      <div className="rounded-3xl bg-white/85 backdrop-blur-md border border-brand-pastel/80 shadow-peach-sm p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-brand-border">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-brand-mist text-brand-coral border border-brand-pastel">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-brand-charcoal">
                Side-by-Side Tactical Response Upgrades
              </h2>
              <p className="text-[11px] text-brand-slate">
                Compare what you said vs. upgraded wording grounded in executive strategy
              </p>
            </div>
          </div>

          {/* Tone Filters */}
          <div className="flex items-center gap-1.5 overflow-x-auto bg-brand-mist p-1 rounded-xl border border-brand-pastel/60">
            {["ALL", "Defensive", "Over-promising", "Resignation"].map((f) => (
              <button
                key={f}
                onClick={() => setFilterTone(f)}
                className={`text-[11px] font-semibold px-3 py-1 rounded-lg transition-all ${
                  filterTone === f
                    ? "bg-white text-brand-coral shadow-xs"
                    : "text-brand-slate hover:text-brand-charcoal"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Upgrade Cards List */}
        <div className="space-y-5">
          {filteredCards.length === 0 ? (
            <div className="p-12 text-center text-brand-slate text-xs space-y-2 rounded-2xl bg-brand-mist/30 border border-brand-pastel/60">
              <Sparkles className="w-8 h-8 text-brand-coral mx-auto animate-pulse" />
              <p className="font-bold text-brand-charcoal text-sm">No Behavioral Cards Yet</p>
              <p className="text-[11px] max-w-md mx-auto leading-relaxed">
                Your workspace starts clean and empty. Record a meeting with your microphone on and Quorum will review how your own lines came across.
              </p>
            </div>
          ) : (
            filteredCards.map((card) => (
            <div
              key={card.id}
              className="rounded-2xl border border-brand-pastel/90 bg-white/95 shadow-xs overflow-hidden transition-all hover:shadow-peach-md"
            >
              {/* Card Meta Bar */}
              <div className="px-5 py-2.5 bg-brand-mist/60 border-b border-brand-pastel/60 flex items-center justify-between text-xs font-semibold">
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1 font-mono text-brand-coral bg-white px-2 py-0.5 rounded border border-brand-pastel">
                    <Clock className="w-3 h-3" />
                    {card.timestamp_ref}
                  </span>
                  <span className="text-brand-slate">Meeting: {card.meeting_title || "Q4 Architecture Sync"}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-rose-700 bg-rose-100 px-2.5 py-0.5 rounded-full font-bold">
                    {card.tone_detected}
                  </span>
                </div>
              </div>

              {/* Side-by-Side Body */}
              <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-brand-border">
                {/* Left: What You Said (Soft Rose Tint) */}
                <div className="p-5 bg-rose-50/40 space-y-3">
                  <div className="flex items-center gap-1.5 text-rose-800 font-bold text-xs uppercase tracking-wider">
                    <AlertCircle className="w-4 h-4 text-rose-500" />
                    <span>What You Said in Meeting</span>
                  </div>
                  <blockquote className="text-sm font-semibold text-brand-charcoal italic bg-white/80 p-3.5 rounded-xl border border-rose-200/80 leading-relaxed">
                    "{card.what_you_said}"
                  </blockquote>
                  <div className="text-xs text-rose-950 font-medium leading-relaxed">
                    <strong className="block text-rose-800 text-[11px] uppercase tracking-wider mb-0.5 font-bold">
                      Suboptimal Impact:
                    </strong>
                    {card.impact_analysis}
                  </div>
                </div>

                {/* Right: How You Should Have Responded (Warm Peach / Gold Highlight) */}
                <div className="p-5 bg-gradient-to-br from-brand-mist/80 via-white to-amber-50/40 space-y-3">
                  <div className="flex items-center gap-1.5 text-brand-coral font-bold text-xs uppercase tracking-wider">
                    <Sparkles className="w-4 h-4 text-brand-coral" />
                    <span>How You Should Have Responded</span>
                  </div>
                  <blockquote className="text-sm font-semibold text-brand-charcoal bg-white p-3.5 rounded-xl border border-brand-peach/80 shadow-xs leading-relaxed text-emerald-950">
                    "{card.better_response}"
                  </blockquote>
                  <div className="text-xs text-brand-slate font-medium leading-relaxed bg-brand-mist/50 p-2.5 rounded-xl border border-brand-pastel/60">
                    <strong className="block text-brand-coral text-[11px] uppercase tracking-wider mb-0.5 font-bold">
                      Psychological & Strategic Principle:
                    </strong>
                    {card.coaching_principle}
                  </div>
                </div>
              </div>
            </div>
          )))}
        </div>
      </div>
    </div>
  );
}
