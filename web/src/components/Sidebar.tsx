"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Radio,
  FileText,
  UserCheck,
  Users,
  Settings,
  Sparkles,
  Download,
  Puzzle,
  CheckCircle2,
} from "lucide-react";
import { api } from "@/lib/api";

const NAV_ITEMS: { href: string; label: string; icon: typeof Radio; badge?: string }[] = [
  { href: "/", label: "Home", icon: Radio },
  { href: "/meetings", label: "Sessions", icon: FileText },
  { href: "/coach", label: "Behavioral Coach", icon: UserCheck },
  { href: "/people", label: "People", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [downloaded, setDownloaded] = useState(false);

  const handleDownloadExtension = () => {
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 4500);
  };

  return (
    <aside
      style={{ position: "fixed" }}
      className="fixed left-4 top-4 bottom-4 w-64 h-[calc(100vh-2rem)] hidden lg:flex flex-col rounded-3xl bg-white/95 backdrop-blur-xl border border-brand-pastel/80 p-4 z-40 justify-between overflow-y-auto no-scrollbar card-3d"
    >
      <div>
        {/* Brand Header */}
        <div className="flex items-center gap-3 px-2 py-3 mb-6 border-b border-brand-border">
          <div className="relative w-9 h-9 rounded-2xl bg-gradient-to-tr from-brand-peach via-brand-coral to-amber-300 p-0.5 shadow-peach-sm flex items-center justify-center pop-hover">
            <div className="w-full h-full rounded-[14px] bg-white flex items-center justify-center">
              <div className="w-4 h-4 rounded-full bg-gradient-to-tr from-brand-peach to-brand-coral" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-base tracking-tight text-brand-charcoal">
                Quorum
              </span>
            </div>
            <p className="text-[10px] uppercase font-bold tracking-widest text-brand-coral">
              Private meeting notes
            </p>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="space-y-2">
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
                    ? "bg-gradient-to-r from-brand-peach to-brand-coral text-white btn-3d translate-x-1"
                    : "text-brand-slate hover:text-brand-charcoal hover:bg-brand-mist/80 pop-hover"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon
                    className={`w-4 h-4 transition-transform group-hover:scale-110 ${
                      isActive ? "text-white" : "text-brand-coral"
                    }`}
                  />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span
                    className={`text-[9.5px] font-bold px-2 py-0.5 rounded-full ${
                      isActive
                        ? "bg-white/20 text-white"
                        : "bg-brand-mist text-brand-coral border border-brand-pastel"
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

      {/* Extension Download & Setup Card in Left Bar */}
      <div className="p-3.5 rounded-2xl bg-gradient-to-br from-brand-mist via-white to-amber-50/40 border border-brand-pastel/90 text-xs pop-hover space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-brand-coral font-extrabold text-[11px] uppercase tracking-wider">
            <Puzzle className="w-3.5 h-3.5" />
            <span>Chrome Extension</span>
          </div>
          <span className="text-[9.5px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            Required
          </span>
        </div>

        <p className="text-[11px] text-brand-slate leading-relaxed font-medium">
          Add the extension in <code className="bg-white px-1 py-0.5 rounded text-[10px] text-brand-charcoal border border-brand-pastel">chrome://extensions</code> (Load unpacked) then click its icon on a meeting tab to record.
        </p>

        <a
          href={api.getExtensionDownloadUrl()}
          download
          onClick={handleDownloadExtension}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold text-white bg-gradient-to-r from-brand-peach to-brand-coral btn-3d"
          title="Download Quorum Chrome Extension (.zip)"
        >
          {downloaded ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Downloaded (.zip)!</span>
            </>
          ) : (
            <>
              <Download className="w-3.5 h-3.5" />
              <span>Download Extension (.zip)</span>
            </>
          )}
        </a>

        <div className="flex items-center justify-between pt-1.5 border-t border-brand-border/70 text-[10px]">
          <span className="text-emerald-600 font-semibold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Manifest V3 Ready
          </span>
          <span className="text-brand-slate font-mono">16kHz Stereo</span>
        </div>
      </div>
    </aside>
  );
}
