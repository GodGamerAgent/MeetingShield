"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Cpu, Search } from "lucide-react";
import { api } from "@/lib/api";
import SessionSwitcher from "@/components/SessionSwitcher";
import GlobalSearchModal from "@/components/GlobalSearchModal";

export default function TopNavbar() {
  const [status, setStatus] = useState<any>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const fetchStatus = async () => {
    try {
      const data = await api.getStatus();
      setStatus(data);
    } catch (e) {
      setStatus(null);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 8000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const isLMOnline = status?.lm_studio?.online;
  const latency = status?.lm_studio?.latency_ms;
  const activeModel = status?.lm_studio?.active_model || "gemma-4";

  return (
    <>
      <header className="sticky top-4 z-30 mb-6 flex flex-wrap items-center justify-between gap-3 px-5 py-3 rounded-2xl bg-white/85 backdrop-blur-md border border-aura-pastel/80 shadow-peach-sm">
        {/* Left: Mobile Title & Session Switcher */}
        <div className="flex items-center gap-3">
          <Link href="/" className="lg:hidden flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-aura-peach to-aura-coral flex items-center justify-center text-white text-xs font-bold">
              A
            </div>
            <span className="font-extrabold text-sm text-aura-charcoal">AURA</span>
          </Link>

          {/* Global Session Switcher */}
          <SessionSwitcher />
        </div>

        {/* Center: Global Omnisearch Trigger */}
        <button
          onClick={() => setIsSearchOpen(true)}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl border border-aura-pastel/80 bg-aura-mist/40 hover:bg-white text-xs text-aura-slate hover:text-aura-charcoal transition-all shadow-inner w-full max-w-xs sm:w-64 order-last sm:order-none"
        >
          <Search className="w-3.5 h-3.5 text-aura-coral flex-shrink-0" />
          <span className="flex-1 text-left truncate font-normal">Search all meetings...</span>
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[9px] font-mono font-bold bg-white text-aura-slate rounded border border-aura-pastel shadow-xs">
            ⌘K
          </kbd>
        </button>

        {/* Right: LM Studio Connection Badge */}
        <div className="flex items-center gap-2.5">
          <Link
            href="/settings"
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs transition-colors shadow-xs ${
              isLMOnline
                ? "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100"
                : "bg-aura-mist text-aura-charcoal border-aura-pastel hover:border-aura-peach"
            }`}
            title="Configure LM Studio and Gemma 4 routing in Settings"
          >
            <Cpu className={`w-3.5 h-3.5 ${isLMOnline ? "text-emerald-600" : "text-aura-coral"}`} />
            <span className="font-semibold hidden sm:inline">
              {isLMOnline ? `Connected: ${activeModel}` : "Local Intelligence Mode"}
            </span>
            <span className="font-semibold sm:hidden">
              {isLMOnline ? "Gemma 4" : "Local AI"}
            </span>
            {isLMOnline && (
              <span className="text-[10px] text-emerald-600 bg-white/70 px-1.5 py-0.2 rounded font-mono">
                {latency}ms
              </span>
            )}
          </Link>
        </div>
      </header>

      {/* Global Omnisearch Modal */}
      <GlobalSearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
    </>
  );
}
