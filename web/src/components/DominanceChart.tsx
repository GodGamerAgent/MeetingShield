"use client";

import React from "react";
import { Mic2, Users } from "lucide-react";
import { DominanceData } from "@/lib/api";

interface DominanceChartProps {
  dominanceData: DominanceData;
}

export default function DominanceChart({ dominanceData }: DominanceChartProps) {
  const speakers = dominanceData?.speakers || [];
  const userPct = dominanceData?.user_talk_time_pct || 0;

  return (
    <div className="flex flex-col h-full justify-between">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Mic2 className="w-4 h-4 text-brand-coral" />
          <span className="text-xs font-semibold uppercase tracking-wider text-brand-slate">
            Dominance & Airtime
          </span>
        </div>
        <span className="text-[11px] font-semibold text-brand-slate">
          {speakers.length} Speakers
        </span>
      </div>

      {/* Stacked Talk Time Bar */}
      <div className="my-2">
        <div className="flex items-center justify-between text-xs mb-1.5 font-medium">
          <span className="text-brand-charcoal">Your Share (ME): <strong className="text-brand-coral">{userPct}%</strong></span>
          <span className="text-brand-slate">Total Spoken: {Math.round(dominanceData?.total_duration_sec || 0)}s</span>
        </div>
        <div className="h-3 w-full bg-brand-mist rounded-full overflow-hidden flex border border-brand-pastel/60">
          {speakers.map((sp, idx) => {
            const colors = [
              "bg-gradient-to-r from-brand-peach to-brand-coral",
              "bg-sky-400",
              "bg-indigo-400",
              "bg-emerald-400",
              "bg-purple-400"
            ];
            const color = sp.is_user ? colors[0] : colors[(idx % 4) + 1];
            return (
              <div
                key={sp.speaker_name}
                style={{ width: `${sp.percentage}%` }}
                className={`${color} transition-all duration-500`}
                title={`${sp.speaker_name}: ${sp.percentage}% (${sp.talk_time_formatted})`}
              />
            );
          })}
        </div>
      </div>

      {/* Speaker Breakdown List */}
      <div className="space-y-1.5 overflow-y-auto max-h-32 pr-1">
        {speakers.map((sp, idx) => (
          <div
            key={sp.speaker_name}
            className={`flex items-center justify-between p-1.5 rounded-lg text-xs transition-colors ${
              sp.is_user ? "bg-brand-mist/80 font-semibold" : "hover:bg-brand-mist/40"
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  sp.is_user ? "bg-brand-coral" : "bg-brand-slate"
                }`}
              />
              <span className="truncate text-brand-charcoal">
                {sp.speaker_name} {sp.is_user && "(ME)"}
              </span>
            </div>
            <div className="flex items-center gap-3 text-brand-slate text-[11px] flex-shrink-0">
              <span>{sp.wpm} WPM</span>
              <span className="font-semibold text-brand-charcoal">{sp.percentage}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
