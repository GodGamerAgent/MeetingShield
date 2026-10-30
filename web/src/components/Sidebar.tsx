"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Radio,
  FileText,
  UserCheck,
  Users,
  Settings,
  Sparkles,
  ShieldAlert,
  CalendarCheck
} from "lucide-react";

const NAV_ITEMS: { href: string; label: string; icon: typeof Radio; badge?: string }[] = [
  { href: "/", label: "Home", icon: Radio },
  { href: "/meetings", label: "Sessions", icon: FileText },
  { href: "/coach", label: "Behavioral Coach", icon: UserCheck },
  { href: "/people", label: "People", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-4 top-4 bottom-4 w-64 hidden lg:flex flex-col rounded-3xl bg-white/85 backdrop-blur-xl border border-aura-pastel/80 shadow-peach-md p-4 z-40 justify-between">
      <div>
        {/* Brand Header */}
        <div className="flex items-center gap-3 px-2 py-3 mb-6 border-b border-aura-border">
          <div className="relative w-9 h-9 rounded-2xl bg-gradient-to-tr from-aura-peach via-aura-coral to-amber-300 p-0.5 shadow-peach-sm flex items-center justify-center">
            <div className="w-full h-full rounded-[14px] bg-white flex items-center justify-center">
              <div className="w-4 h-4 rounded-full bg-gradient-to-tr from-aura-peach to-aura-coral animate-pulse-slow" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-base tracking-tight text-aura-charcoal">
                AURA-MEET
              </span>
            </div>
            <p className="text-[10px] uppercase font-bold tracking-widest text-aura-coral">
              On-Device Copilot
            </p>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="space-y-1.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center justify-between px-3.5 py-2.5 rounded-2xl text-xs font-semibold transition-all duration-200 group ${
                  isActive
                    ? "bg-gradient-to-r from-aura-peach to-aura-coral text-white shadow-peach-sm translate-x-1"
                    : "text-aura-slate hover:text-aura-charcoal hover:bg-aura-mist/80"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon
                    className={`w-4 h-4 transition-transform group-hover:scale-110 ${
                      isActive ? "text-white" : "text-aura-coral"
                    }`}
                  />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span
                    className={`text-[9.5px] font-bold px-2 py-0.5 rounded-full ${
                      isActive
                        ? "bg-white/20 text-white"
                        : "bg-aura-mist text-aura-coral border border-aura-pastel"
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Extension Link Card */}
      <div className="p-3.5 rounded-2xl bg-gradient-to-br from-aura-mist to-white border border-aura-pastel/80 text-xs shadow-xs">
        <div className="flex items-center gap-2 mb-1.5 text-aura-coral font-bold text-[11px] uppercase tracking-wider">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Chrome Extension</span>
        </div>
        <p className="text-[11px] text-aura-slate leading-relaxed mb-2.5 font-medium">
          Load <code className="bg-white px-1 py-0.5 rounded text-[10px] text-aura-charcoal border border-aura-pastel">/extension</code> in <code className="text-[10px]">chrome://extensions</code> — it detects Meet, Zoom &amp; Teams calls and records each one as a session.
        </p>
        <div className="flex items-center justify-between pt-2 border-t border-aura-border/70 text-[10.5px]">
          <span className="text-emerald-600 font-semibold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Manifest V3 Ready
          </span>
          <span className="text-aura-slate">FastAPI :8000</span>
        </div>
      </div>
    </aside>
  );
}
