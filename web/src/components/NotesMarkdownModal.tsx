"use client";

import React, { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Maximize2,
  Minimize2,
  FolderOpen,
  Copy,
  Check,
  FileDown,
  FileCode2,
  Eye,
  Columns,
  Sparkles,
  CheckSquare,
  Square,
  AlertTriangle,
  Info,
  Lightbulb,
  Flame,
  HelpCircle,
  Bookmark,
  Hash,
  Link2,
  Terminal,
  Save,
  Clock,
  ChevronDown,
  ChevronRight,
  Laptop,
} from "lucide-react";
import { api } from "@/lib/api";

export type DetectedOS = "mac" | "win" | "linux";

interface NotesMarkdownModalProps {
  meetingId: string;
  meetingTitle?: string;
  isOpen: boolean;
  onClose: () => void;
  onCitationClick?: (timestamp: string) => void;
}

interface ParsedFrontmatter {
  properties: Record<string, string | string[]>;
  body: string;
}

function detectUserOS(): DetectedOS {
  if (typeof window === "undefined") return "linux";
  const ua = (
    window.navigator.userAgent ||
    window.navigator.platform ||
    ""
  ).toLowerCase();
  if (ua.includes("mac") || ua.includes("darwin")) return "mac";
  if (ua.includes("win")) return "win";
  return "linux";
}

export function getOsFileManagerConfig(os: DetectedOS) {
  switch (os) {
    case "mac":
      return {
        os: "mac" as const,
        osName: "macOS",
        managerName: "Finder",
        buttonLabel: "Open in Finder",
        shortHint: "Reveals meeting_notes.md in macOS Finder",
      };
    case "win":
      return {
        os: "win" as const,
        osName: "Windows",
        managerName: "File Explorer",
        buttonLabel: "Open in Explorer",
        shortHint: "Reveals meeting_notes.md in Windows Explorer",
      };
    case "linux":
    default:
      return {
        os: "linux" as const,
        osName: "Linux",
        managerName: "Thunar",
        buttonLabel: "Open in Thunar",
        shortHint: "Opens session folder in Thunar / Linux File Manager",
      };
  }
}

export function parseYamlFrontmatter(markdown: string): ParsedFrontmatter {
  const trimmed = markdown.trimStart();
  if (!trimmed.startsWith("---")) {
    return { properties: {}, body: markdown };
  }
  const lines = trimmed.split("\n");
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) {
    return { properties: {}, body: markdown };
  }

  const yamlLines = lines.slice(1, endIdx);
  const properties: Record<string, string | string[]> = {};
  let currentKey: string | null = null;

  for (const rawLine of yamlLines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("- ") && currentKey) {
      const val = line
        .slice(2)
        .trim()
        .replace(/^["']|["']$/g, "");
      const existing = properties[currentKey];
      if (Array.isArray(existing)) {
        existing.push(val);
      } else {
        properties[currentKey] = [val];
      }
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim();
      const rawVal = line.slice(colonIdx + 1).trim();
      currentKey = key;
      if (!rawVal) {
        properties[key] = [];
      } else if (rawVal.startsWith("[") && rawVal.endsWith("]")) {
        const items = rawVal
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
        properties[key] = items;
      } else {
        properties[key] = rawVal.replace(/^["']|["']$/g, "");
      }
    }
  }

  const body = lines.slice(endIdx + 1).join("\n").replace(/^\n+/, "");
  return { properties, body };
}

export default function NotesMarkdownModal({
  meetingId,
  meetingTitle,
  isOpen,
  onClose,
  onCitationClick,
}: NotesMarkdownModalProps) {
  const [mounted, setMounted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [viewMode, setViewMode] = useState<"rendered" | "split" | "raw">("rendered");
  const [markdown, setMarkdown] = useState("");
  const [filePath, setFilePath] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);
  const [detectedOs, setDetectedOs] = useState<DetectedOS>("linux");
  const [revealResult, setRevealResult] = useState<{
    button_label: string;
    file_manager_name: string;
    command: string;
    file_path: string;
    folder_path: string;
    message: string;
  } | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [collapsedCallouts, setCollapsedCallouts] = useState<Record<number, boolean>>({});

  useEffect(() => {
    setMounted(true);
    setDetectedOs(detectUserOS());
  }, []);

  useEffect(() => {
    if (isOpen && meetingId) {
      setLoading(true);
      setRevealResult(null);
      api
        .getMeetingMarkdown(meetingId)
        .then((res) => {
          setMarkdown(res.content || "");
          setFilePath(res.file_path || `/tmp/quorum-recordings/${meetingId}/meeting_notes.md`);
          setFolderPath(res.folder_path || `/tmp/quorum-recordings/${meetingId}`);
        })
        .catch((err) => {
          console.warn("Failed to load markdown:", err);
        })
        .finally(() => setLoading(false));
    }
  }, [isOpen, meetingId]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const parsed = useMemo(() => parseYamlFrontmatter(markdown), [markdown]);
  const osConfig = useMemo(() => getOsFileManagerConfig(detectedOs), [detectedOs]);

  if (!isOpen || !mounted) return null;

  const handleRevealInFileManager = async (overrideOs?: DetectedOS) => {
    const targetOs = overrideOs || detectedOs;
    setRevealing(true);
    try {
      const res = await api.revealMeetingInFolder(meetingId, targetOs);
      setRevealResult(res);
      if (res.file_path) setFilePath(res.file_path);
      if (res.folder_path) setFolderPath(res.folder_path);
    } catch (e) {
      console.warn("Could not reveal folder:", e);
    } finally {
      setRevealing(false);
    }
  };

  const handleSaveMarkdown = async () => {
    if (!meetingId) return;
    setSaving(true);
    try {
      const res = await api.saveMeetingMarkdown(meetingId, markdown);
      if (res.file_path) setFilePath(res.file_path);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2200);
    } catch (e) {
      console.warn("Failed to save markdown:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleCopyMarkdown = () => {
    navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  const handleCopyPath = (textToCopy: string) => {
    navigator.clipboard.writeText(textToCopy);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 2200);
  };

  const toggleTaskItemInMarkdown = (lineIndexInBody: number) => {
    const frontmatterBlock = markdown.startsWith("---")
      ? markdown.slice(0, markdown.indexOf("---", 3) + 3) + "\n"
      : "";
    const bodyLines = parsed.body.split("\n");
    const target = bodyLines[lineIndexInBody];
    if (!target) return;
    if (/^(\s*[-*]\s+)\[x\]/i.test(target)) {
      bodyLines[lineIndexInBody] = target.replace(/^(\s*[-*]\s+)\[x\]/i, "$1[ ]");
    } else if (/^(\s*[-*]\s+)\[\s\]/.test(target)) {
      bodyLines[lineIndexInBody] = target.replace(/^(\s*[-*]\s+)\[\s\]/, "$1[x]");
    }
    const updated = frontmatterBlock + bodyLines.join("\n");
    setMarkdown(updated);
    api.saveMeetingMarkdown(meetingId, updated).catch(() => {});
  };

  // Inline parser for both GitHub Flavored Markdown and Obsidian Flavored Markdown
  const renderInlineMarkdown = (text: string, keyPrefix = "inl"): React.ReactNode[] => {
    if (!text) return [];

    // Tokenize:
    // 1. Inline code `...`
    // 2. Obsidian embed ![[...]] or Wikilinks [[Page|Alias]] / [[Page]]
    // 3. Obsidian Highlights ==...==
    // 4. Strikethrough ~~...~~
    // 5. Bold **...**
    // 6. Italic *...*
    // 7. Standard Markdown link [text](url)
    // 8. Timestamp citations [HH:MM:SS]
    // 9. Obsidian inline #tags
    const tokenRegex =
      /(`[^`]+`|!\[\[[^\]]+\]\]|\[\[[^\]]+\]\]|==[^=]+==|~~[^~]+~~|\*\*[^*]+\*\*|\*[^*\n]+\*|\[[^\]]+\]\([^)]+\)|\[\d{2}:\d{2}:\d{2}\]|(?:^|\s)#[a-zA-Z][\w/-]*)/g;

    const parts = text.split(tokenRegex);
    return parts.map((part, idx) => {
      const key = `${keyPrefix}-${idx}`;
      if (!part) return null;

      // 1. Inline code (`[00:01:25]` or `code`)
      if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
        const inner = part.slice(1, -1);
        const tsMatch = inner.match(/^\[(\d{2}:\d{2}:\d{2})\]$/);
        if (tsMatch) {
          const ts = tsMatch[1];
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                if (onCitationClick) {
                  onCitationClick(ts);
                  onClose();
                }
              }}
              className="inline-flex items-center gap-1 font-mono text-[11px] font-bold px-2 py-0.5 rounded-md bg-[#FFF4EE] text-[#FF7F50] border border-[#FFD8C7] hover:bg-[#FF7F50] hover:text-white transition-colors mx-0.5"
              title={`Jump to ${ts} in meeting audio`}
            >
              <Clock className="w-2.5 h-2.5" />
              {ts}
            </button>
          );
        }
        return (
          <code
            key={key}
            className="font-mono text-[12px] font-semibold px-1.5 py-0.5 rounded-md bg-[#F8F1EE] text-[#C84B20] border border-[#EEDAD2]"
          >
            {inner}
          </code>
        );
      }

      // 2. Obsidian Embed ![[...]] or Wikilink [[target|alias]]
      if (
        (part.startsWith("![[") && part.endsWith("]]")) ||
        (part.startsWith("[[") && part.endsWith("]]"))
      ) {
        const isEmbed = part.startsWith("![[");
        const rawInner = part.slice(isEmbed ? 3 : 2, -2);
        const [target, alias] = rawInner.split("|");
        const label = (alias || target || "").trim();
        return (
          <span
            key={key}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold bg-violet-50 text-violet-800 border border-violet-200 shadow-2xs mx-0.5"
            title={`Obsidian Wikilink → ${target.trim()}`}
          >
            <Link2 className="w-3 h-3 text-violet-600 flex-shrink-0" />
            <span>{label}</span>
          </span>
        );
      }

      // 3. Obsidian Highlight ==text==
      if (part.startsWith("==") && part.endsWith("==") && part.length > 4) {
        const inner = part.slice(2, -2);
        return (
          <mark
            key={key}
            className="bg-amber-200/85 text-[#2B2129] px-1.5 py-0.5 rounded-md font-bold border border-amber-300/80"
          >
            {renderInlineMarkdown(inner, `${key}-hl`)}
          </mark>
        );
      }

      // 4. GFM Strikethrough ~~text~~
      if (part.startsWith("~~") && part.endsWith("~~") && part.length > 4) {
        const inner = part.slice(2, -2);
        return (
          <del key={key} className="line-through text-[#8C7A84] decoration-rose-500">
            {renderInlineMarkdown(inner, `${key}-del`)}
          </del>
        );
      }

      // 5. Bold **text**
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        const inner = part.slice(2, -2);
        return (
          <strong key={key} className="font-extrabold text-[#2B2129]">
            {renderInlineMarkdown(inner, `${key}-b`)}
          </strong>
        );
      }

      // 6. Italic *text*
      if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
        const inner = part.slice(1, -1);
        return (
          <em key={key} className="italic text-[#4A3B46]">
            {renderInlineMarkdown(inner, `${key}-i`)}
          </em>
        );
      }

      // 7. Standard Markdown Link [label](url)
      const mdLink = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (mdLink) {
        return (
          <a
            key={key}
            href={mdLink[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-[#FF7F50] underline decoration-[#FF9E7D] hover:text-[#2B2129]"
          >
            {mdLink[1]}
          </a>
        );
      }

      // 8. Bare [HH:MM:SS] citation
      const bareTs = part.match(/^\[(\d{2}:\d{2}:\d{2})\]$/);
      if (bareTs) {
        const ts = bareTs[1];
        return (
          <button
            key={key}
            type="button"
            onClick={() => {
              if (onCitationClick) {
                onCitationClick(ts);
                onClose();
              }
            }}
            className="inline-flex items-center gap-1 font-mono text-[11px] font-bold px-2 py-0.5 rounded-md bg-[#FFF4EE] text-[#FF7F50] border border-[#FFD8C7] hover:bg-[#FF7F50] hover:text-white transition-colors mx-0.5"
          >
            <Clock className="w-2.5 h-2.5" />
            {ts}
          </button>
        );
      }

      // 9. Obsidian #tag
      const tagMatch = part.match(/^(\s*)(#[a-zA-Z][\w/-]*)$/);
      if (tagMatch) {
        return (
          <React.Fragment key={key}>
            {tagMatch[1]}
            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#FFF4EE] text-[#FF7F50] border border-[#FFD8C7]">
              <Hash className="w-2.5 h-2.5" />
              {tagMatch[2].slice(1)}
            </span>
          </React.Fragment>
        );
      }

      return <span key={key}>{part}</span>;
    });
  };

  // Block-level parser for GitHub (GFM) + Obsidian Markdown
  const renderMarkdownBlocks = (bodyText: string) => {
    const lines = bodyText.split("\n");
    const elements: React.ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip blank lines
      if (!trimmed) {
        i++;
        continue;
      }

      // 1. Fenced Code Block ```lang ... ```
      if (trimmed.startsWith("```")) {
        const lang = trimmed.slice(3).trim() || "text";
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith("```")) {
          codeLines.push(lines[i]);
          i++;
        }
        i++; // skip closing ```
        const codeContent = codeLines.join("\n");
        elements.push(
          <div
            key={`code-${i}`}
            className="my-4 rounded-2xl overflow-hidden border border-[#2B2129]/20 bg-[#1E191D] text-slate-100 shadow-sm"
          >
            <div className="px-4 py-2 bg-[#2B2129] border-b border-white/10 flex items-center justify-between text-[11px] font-mono text-slate-300">
              <span className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[#FF9E7D]">
                <FileCode2 className="w-3.5 h-3.5" />
                {lang}
              </span>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(codeContent)}
                className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white text-[10px] font-sans font-semibold transition-colors"
              >
                Copy snippet
              </button>
            </div>
            <pre className="p-4 text-xs font-mono leading-relaxed overflow-x-auto">
              <code>{codeContent}</code>
            </pre>
          </div>
        );
        continue;
      }

      // 2. Horizontal Rule --- or ***
      if (/^(---+|\*\*\*+|___+)$/.test(trimmed)) {
        elements.push(
          <hr key={`hr-${i}`} className="my-6 border-t-2 border-[#F5E6DF]" />
        );
        i++;
        continue;
      }

      // 3. Obsidian Callout or Standard Blockquote (> [!TYPE] Title or > quote)
      if (trimmed.startsWith(">")) {
        const blockIdx = i;
        const quoteLines: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith(">")) {
          quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
          i++;
        }

        const firstLine = quoteLines[0] || "";
        const calloutMatch = firstLine.match(/^\[!([a-zA-Z]+)\]([+-])?\s*(.*)$/);

        if (calloutMatch) {
          const calloutType = calloutMatch[1].toUpperCase();
          const customTitle = calloutMatch[3] || calloutType;
          const contentLines = quoteLines.slice(1);

          const themeMap: Record<
            string,
            { bg: string; border: string; headerBg: string; text: string; icon: React.ReactNode }
          > = {
            SUMMARY: {
              bg: "bg-[#FFF4EE]",
              border: "border-[#FF9E7D]",
              headerBg: "bg-[#FFE6D8]",
              text: "text-[#2B2129]",
              icon: <Sparkles className="w-4 h-4 text-[#FF7F50]" />,
            },
            IMPORTANT: {
              bg: "bg-emerald-50/90",
              border: "border-emerald-300",
              headerBg: "bg-emerald-100/80",
              text: "text-emerald-950",
              icon: <CheckSquare className="w-4 h-4 text-emerald-700" />,
            },
            WARNING: {
              bg: "bg-amber-50/90",
              border: "border-amber-300",
              headerBg: "bg-amber-100/80",
              text: "text-amber-950",
              icon: <AlertTriangle className="w-4 h-4 text-amber-700" />,
            },
            DANGER: {
              bg: "bg-rose-50/90",
              border: "border-rose-300",
              headerBg: "bg-rose-100/80",
              text: "text-rose-950",
              icon: <Flame className="w-4 h-4 text-rose-700" />,
            },
            TIP: {
              bg: "bg-violet-50/90",
              border: "border-violet-300",
              headerBg: "bg-violet-100/80",
              text: "text-violet-950",
              icon: <Lightbulb className="w-4 h-4 text-violet-700" />,
            },
            QUESTION: {
              bg: "bg-sky-50/90",
              border: "border-sky-300",
              headerBg: "bg-sky-100/80",
              text: "text-sky-950",
              icon: <HelpCircle className="w-4 h-4 text-sky-700" />,
            },
            NOTE: {
              bg: "bg-blue-50/80",
              border: "border-blue-200",
              headerBg: "bg-blue-100/70",
              text: "text-blue-950",
              icon: <Info className="w-4 h-4 text-blue-700" />,
            },
          };

          const theme = themeMap[calloutType] || themeMap.NOTE;
          const isCollapsed = Boolean(collapsedCallouts[blockIdx]);

          elements.push(
            <div
              key={`callout-${blockIdx}`}
              className={`my-4 rounded-2xl border-l-4 border ${theme.border} ${theme.bg} overflow-hidden shadow-xs`}
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() =>
                  setCollapsedCallouts((prev) => ({
                    ...prev,
                    [blockIdx]: !prev[blockIdx],
                  }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setCollapsedCallouts((prev) => ({
                      ...prev,
                      [blockIdx]: !prev[blockIdx],
                    }));
                  }
                }}
                className={`w-full px-4 py-2.5 ${theme.headerBg} flex items-center justify-between text-left cursor-pointer`}
              >
                <div className="flex items-center gap-2">
                  {theme.icon}
                  <span className="text-xs font-extrabold uppercase tracking-wider px-2 py-0.5 rounded bg-white/80 text-[#2B2129] border border-black/5">
                    [!{calloutType}]
                  </span>
                  <span className={`text-sm font-extrabold ${theme.text}`}>
                    {renderInlineMarkdown(customTitle, `co-title-${blockIdx}`)}
                  </span>
                </div>
                {isCollapsed ? (
                  <ChevronRight className="w-4 h-4 text-[#5C4E58]" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[#5C4E58]" />
                )}
              </div>
              {!isCollapsed && contentLines.length > 0 && (
                <div className={`p-4 space-y-2 text-sm ${theme.text} leading-relaxed`}>
                  {contentLines.map((cl, cIdx) => {
                    const cTrim = cl.trim();
                    if (!cTrim) return <div key={cIdx} className="h-1" />;
                    const taskM = cTrim.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/);
                    if (taskM) {
                      const checked = taskM[1].toLowerCase() === "x";
                      return (
                        <div key={cIdx} className="flex items-start gap-2.5">
                          <span
                            className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center flex-shrink-0 ${
                              checked
                                ? "bg-emerald-600 text-white"
                                : "border border-[#5C4E58] bg-white"
                            }`}
                          >
                            {checked && <Check className="w-3 h-3" />}
                          </span>
                          <span className="leading-relaxed">
                            {renderInlineMarkdown(taskM[2], `co-task-${blockIdx}-${cIdx}`)}
                          </span>
                        </div>
                      );
                    }
                    if (cTrim.startsWith("- ") || cTrim.startsWith("* ")) {
                      return (
                        <div key={cIdx} className="flex items-start gap-2 pl-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-current mt-2 flex-shrink-0" />
                          <span>
                            {renderInlineMarkdown(cTrim.slice(2), `co-li-${blockIdx}-${cIdx}`)}
                          </span>
                        </div>
                      );
                    }
                    return (
                      <p key={cIdx}>
                        {renderInlineMarkdown(cTrim, `co-p-${blockIdx}-${cIdx}`)}
                      </p>
                    );
                  })}
                </div>
              )}
            </div>
          );
        } else {
          // Standard GitHub Blockquote
          elements.push(
            <blockquote
              key={`quote-${blockIdx}`}
              className="my-4 pl-4 py-2 border-l-4 border-[#FF7F50] bg-[#FFF4EE]/60 rounded-r-2xl text-sm italic text-[#2B2129] space-y-1.5"
            >
              {quoteLines.map((ql, qIdx) => (
                <p key={qIdx}>{renderInlineMarkdown(ql, `bq-${blockIdx}-${qIdx}`)}</p>
              ))}
            </blockquote>
          );
        }
        continue;
      }

      // 4. GFM Pipe Table (| col | col | followed by | --- | --- |)
      if (
        trimmed.startsWith("|") &&
        i + 1 < lines.length &&
        /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])
      ) {
        const tableStart = i;
        const parseRow = (rowStr: string) =>
          rowStr
            .trim()
            .replace(/^\||\|$/g, "")
            .split(/(?<!\\)\|/)
            .map((cell) => cell.trim().replace(/\\\|/g, "|"));

        const headers = parseRow(lines[i]);
        const alignSpecs = parseRow(lines[i + 1]).map((spec) => {
          if (spec.startsWith(":") && spec.endsWith(":")) return "text-center";
          if (spec.endsWith(":")) return "text-right";
          return "text-left";
        });
        i += 2;

        const rows: string[][] = [];
        while (i < lines.length && lines[i].trim().startsWith("|")) {
          rows.push(parseRow(lines[i]));
          i++;
        }

        elements.push(
          <div
            key={`table-${tableStart}`}
            className="my-4 overflow-x-auto rounded-2xl border-2 border-[#FFD8C7] shadow-xs bg-white"
          >
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-[#FFF4EE] border-b-2 border-[#FFD8C7]">
                  {headers.map((h, hIdx) => (
                    <th
                      key={hIdx}
                      className={`px-4 py-3 text-xs font-extrabold uppercase tracking-wider text-[#2B2129] ${
                        alignSpecs[hIdx] || "text-left"
                      }`}
                    >
                      {renderInlineMarkdown(h, `th-${tableStart}-${hIdx}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F5E6DF]">
                {rows.map((r, rIdx) => (
                  <tr
                    key={rIdx}
                    className={rIdx % 2 === 0 ? "bg-white" : "bg-[#FFFDFB]"}
                  >
                    {headers.map((_, cIdx) => (
                      <td
                        key={cIdx}
                        className={`px-4 py-3 text-sm text-[#2B2129] ${
                          alignSpecs[cIdx] || "text-left"
                        }`}
                      >
                        {renderInlineMarkdown(
                          r[cIdx] || "",
                          `td-${tableStart}-${rIdx}-${cIdx}`
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }

      // 5. Headings (# to ######)
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const content = headingMatch[2];
        const headingStyles: Record<number, string> = {
          1: "text-2xl sm:text-3xl font-extrabold text-[#2B2129] pb-3 mb-4 border-b-2 border-[#FFD8C7] mt-2",
          2: "text-lg sm:text-xl font-extrabold text-[#2B2129] pb-2 mt-6 mb-3 border-b border-[#F5E6DF] flex items-center gap-2",
          3: "text-base font-extrabold text-[#2B2129] mt-4 mb-2",
          4: "text-sm font-bold text-[#2B2129] uppercase tracking-wider mt-3 mb-1.5",
          5: "text-xs font-bold text-[#5C4E58] uppercase tracking-wider mt-2 mb-1",
          6: "text-xs font-semibold text-[#5C4E58] mt-2 mb-1",
        };
        elements.push(
          <div key={`h-${i}`} className={headingStyles[level] || headingStyles[3]}>
            {renderInlineMarkdown(content, `hd-${i}`)}
          </div>
        );
        i++;
        continue;
      }

      // 6. Unordered List or GFM Task List (- [x], - [ ], - item, * item)
      if (/^[-*•]\s+/.test(trimmed)) {
        const listStart = i;
        const listItems: { lineIdx: number; text: string; isTask: boolean; checked: boolean }[] = [];
        while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
          const rawItem = lines[i].trim().replace(/^[-*•]\s+/, "");
          const taskMatch = rawItem.match(/^\[([ xX])\]\s+(.*)$/);
          if (taskMatch) {
            listItems.push({
              lineIdx: i,
              text: taskMatch[2],
              isTask: true,
              checked: taskMatch[1].toLowerCase() === "x",
            });
          } else {
            listItems.push({
              lineIdx: i,
              text: rawItem,
              isTask: false,
              checked: false,
            });
          }
          i++;
        }

        elements.push(
          <ul key={`ul-${listStart}`} className="my-3 space-y-2">
            {listItems.map((item, idx) =>
              item.isTask ? (
                <li
                  key={idx}
                  className={`flex items-start gap-3 p-2.5 rounded-xl border transition-colors ${
                    item.checked
                      ? "bg-emerald-50/50 border-emerald-200/80 text-[#5C4E58]"
                      : "bg-[#FFFDFB] border-[#F5E6DF] text-[#2B2129]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleTaskItemInMarkdown(item.lineIdx)}
                    className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-colors ${
                      item.checked
                        ? "bg-[#FF7F50] text-white"
                        : "border-2 border-[#FF9E7D] bg-white hover:bg-[#FFF4EE]"
                    }`}
                    title="Toggle GitHub/Obsidian task checkbox"
                  >
                    {item.checked && <Check className="w-3 h-3" />}
                  </button>
                  <span
                    className={`text-sm leading-relaxed flex-1 ${
                      item.checked ? "line-through text-[#8C7A84]" : "text-[#2B2129]"
                    }`}
                  >
                    {renderInlineMarkdown(item.text, `task-${listStart}-${idx}`)}
                  </span>
                </li>
              ) : (
                <li
                  key={idx}
                  className="flex items-start gap-2.5 pl-1 text-sm text-[#2B2129] leading-relaxed"
                >
                  <span className="w-2 h-2 rounded-full bg-[#FF7F50] mt-2 flex-shrink-0" />
                  <span className="flex-1">
                    {renderInlineMarkdown(item.text, `li-${listStart}-${idx}`)}
                  </span>
                </li>
              )
            )}
          </ul>
        );
        continue;
      }

      // 7. Ordered List (1. item)
      if (/^\d+\.\s+/.test(trimmed)) {
        const olStart = i;
        const olItems: string[] = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          olItems.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
          i++;
        }
        elements.push(
          <ol key={`ol-${olStart}`} className="my-3 space-y-2 pl-5 list-decimal text-sm text-[#2B2129]">
            {olItems.map((item, idx) => (
              <li key={idx} className="leading-relaxed pl-1">
                {renderInlineMarkdown(item, `ol-${olStart}-${idx}`)}
              </li>
            ))}
          </ol>
        );
        continue;
      }

      // 8. Standard Paragraph
      elements.push(
        <p key={`p-${i}`} className="my-2.5 text-sm text-[#2B2129] leading-relaxed">
          {renderInlineMarkdown(trimmed, `p-${i}`)}
        </p>
      );
      i++;
    }

    return elements;
  };

  const modalNode = (
    <div
      className="fixed inset-0 z-[260] flex items-center justify-center bg-[#2B2129]/70 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="notes-md-modal-title"
    >
      <div
        className={`bg-white border-2 border-[#FFD8C7] shadow-2xl flex flex-col overflow-hidden transition-all duration-200 ${
          isFullscreen
            ? "w-screen h-screen max-w-none rounded-none border-0"
            : "w-[94vw] max-w-6xl h-[88vh] rounded-3xl"
        }`}
        style={{ backgroundColor: "#FFFFFF", color: "#2B2129" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Action Bar */}
        <div className="px-5 py-3.5 border-b border-[#F5E6DF] bg-gradient-to-r from-[#FFF4EE] via-white to-[#FFF4EE] flex flex-wrap items-center justify-between gap-3">
          {/* Left: Title & Format Badges */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#FF9E7D] to-[#FF7F50] text-white flex items-center justify-center shadow-xs flex-shrink-0">
              <FileCode2 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id="notes-md-modal-title"
                  className="text-base sm:text-lg font-extrabold text-[#2B2129] truncate"
                >
                  {meetingTitle ? `${meetingTitle} — Notes.md` : "meeting_notes.md"}
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10.5px] font-extrabold bg-violet-100 text-violet-800 border border-violet-200">
                  Obsidian Vault Ready
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10.5px] font-extrabold bg-slate-100 text-slate-800 border border-slate-200">
                  GitHub GFM
                </span>
              </div>
              <p className="text-[11px] font-mono text-[#5C4E58] truncate mt-0.5">
                {filePath || `/tmp/quorum-recordings/${meetingId}/meeting_notes.md`}
              </p>
            </div>
          </div>

          {/* Right: OS File Manager Button + View Switcher + Fullscreen Toggle + Close */}
          <div className="flex flex-wrap items-center gap-2">
            {/* OS Selector + Open in Finder / Explorer / Thunar Button */}
            <div className="flex items-center rounded-xl border-2 border-[#FFD8C7] bg-[#FFF4EE] p-0.5 shadow-2xs">
              <button
                type="button"
                onClick={() => handleRevealInFileManager(detectedOs)}
                disabled={revealing}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-extrabold bg-gradient-to-r from-[#FF9E7D] to-[#FF7F50] text-white hover:opacity-95 transition-all shadow-xs"
                title={osConfig.shortHint}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>{revealing ? "Opening..." : osConfig.buttonLabel}</span>
              </button>

              <select
                aria-label="Select operating system file manager"
                value={detectedOs}
                onChange={(e) => {
                  const nextOs = e.target.value as DetectedOS;
                  setDetectedOs(nextOs);
                  handleRevealInFileManager(nextOs);
                }}
                className="px-2 py-1 text-[11px] font-bold text-[#2B2129] bg-transparent focus:outline-none cursor-pointer"
                title="Switch OS File Manager (Finder / Explorer / Thunar)"
              >
                <option value="mac">macOS (Finder)</option>
                <option value="win">Windows (Explorer)</option>
                <option value="linux">Linux (Thunar)</option>
              </select>
            </div>

            {/* View Mode Switcher */}
            <div className="flex items-center gap-1 bg-[#FFF4EE] p-1 rounded-xl border border-[#FFD8C7]">
              <button
                type="button"
                onClick={() => setViewMode("rendered")}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                  viewMode === "rendered"
                    ? "bg-white text-[#2B2129] shadow-2xs border border-[#FFD8C7]"
                    : "text-[#5C4E58] hover:text-[#2B2129]"
                }`}
              >
                <Eye className="w-3.5 h-3.5 text-[#FF7F50]" />
                <span>Rendered</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("split")}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                  viewMode === "split"
                    ? "bg-white text-[#2B2129] shadow-2xs border border-[#FFD8C7]"
                    : "text-[#5C4E58] hover:text-[#2B2129]"
                }`}
              >
                <Columns className="w-3.5 h-3.5 text-[#FF7F50]" />
                <span>Split</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("raw")}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                  viewMode === "raw"
                    ? "bg-white text-[#2B2129] shadow-2xs border border-[#FFD8C7]"
                    : "text-[#5C4E58] hover:text-[#2B2129]"
                }`}
              >
                <FileCode2 className="w-3.5 h-3.5 text-[#FF7F50]" />
                <span>Raw .md</span>
              </button>
            </div>

            {/* Copy Markdown */}
            <button
              type="button"
              onClick={handleCopyMarkdown}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-white hover:bg-[#FFF4EE] text-[#2B2129] border border-[#FFD8C7] transition-colors"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-[#FF7F50]" />
              )}
              <span>{copied ? "Copied!" : "Copy .md"}</span>
            </button>

            {/* Fullscreen / Windowed Toggle */}
            <button
              type="button"
              onClick={() => setIsFullscreen((f) => !f)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#FFF4EE] hover:bg-[#FFD8C7] text-[#2B2129] border border-[#FFD8C7] transition-colors"
              title={isFullscreen ? "Restore windowed dialog" : "Fill entire screen"}
            >
              {isFullscreen ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5 text-[#FF7F50]" />
                  <span className="hidden sm:inline">Windowed</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5 text-[#FF7F50]" />
                  <span className="hidden sm:inline">Fill Screen</span>
                </>
              )}
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Markdown viewer"
              className="p-2 rounded-xl bg-[#FFF4EE] hover:bg-rose-100 text-[#2B2129] hover:text-rose-700 border border-[#FFD8C7] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* OS File Manager Reveal Confirmation Bar (when Open in Finder/Explorer/Thunar is clicked) */}
        {revealResult && (
          <div className="px-6 py-3 bg-emerald-50 border-b border-emerald-200 flex flex-wrap items-center justify-between gap-3 text-xs text-emerald-950 animate-in fade-in duration-150">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-extrabold flex items-center gap-1.5">
                <Laptop className="w-3.5 h-3.5" />
                {revealResult.file_manager_name} Ready
              </span>
              <span className="font-semibold">
                Local File:{" "}
                <code className="font-mono font-bold bg-white px-2 py-0.5 rounded border border-emerald-300">
                  {revealResult.file_path}
                </code>
              </span>
              <span className="text-emerald-800 font-mono text-[11px] bg-emerald-100/80 px-2 py-0.5 rounded border border-emerald-200">
                $ {revealResult.command}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleCopyPath(revealResult.file_path)}
                className="px-3 py-1 rounded-lg bg-white hover:bg-emerald-100 text-emerald-900 border border-emerald-300 font-bold flex items-center gap-1"
              >
                {copiedPath ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                <span>{copiedPath ? "Path Copied" : "Copy File Path"}</span>
              </button>
              <button
                type="button"
                onClick={() => setRevealResult(null)}
                className="p-1 rounded-lg hover:bg-emerald-200/60 text-emerald-800"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Main Content Workspace */}
        <div className="flex-1 overflow-hidden bg-[#FFFDFB] flex flex-col">
          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm font-semibold text-[#2B2129]">
              <Sparkles className="w-6 h-6 text-[#FF7F50] animate-spin" />
              <span>Loading GitHub &amp; Obsidian Markdown document...</span>
            </div>
          ) : (
            <div
              className={`flex-1 overflow-hidden grid ${
                viewMode === "split" ? "grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#FFD8C7]" : "grid-cols-1"
              }`}
            >
              {/* Raw / Live Markdown Editor Pane */}
              {(viewMode === "raw" || viewMode === "split") && (
                <div className="h-full flex flex-col bg-[#1E191D] text-slate-100 overflow-hidden">
                  <div className="px-5 py-2.5 bg-[#2B2129] border-b border-white/10 flex items-center justify-between text-xs">
                    <span className="font-mono font-bold text-[#FF9E7D] flex items-center gap-2">
                      <Terminal className="w-3.5 h-3.5" />
                      meeting_notes.md (Obsidian &amp; GFM Source)
                    </span>
                    <div className="flex items-center gap-2">
                      {savedToast && (
                        <span className="text-emerald-400 font-bold flex items-center gap-1 text-[11px]">
                          <Check className="w-3.5 h-3.5" /> Saved to disk
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={handleSaveMarkdown}
                        disabled={saving}
                        className="px-3 py-1 rounded-lg bg-[#FF7F50] hover:bg-[#FF9E7D] text-white font-bold text-[11px] flex items-center gap-1 transition-colors"
                      >
                        <Save className="w-3 h-3" />
                        <span>{saving ? "Saving..." : "Save to Disk"}</span>
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={markdown}
                    onChange={(e) => setMarkdown(e.target.value)}
                    spellCheck={false}
                    className="flex-1 w-full p-5 font-mono text-xs sm:text-[13px] leading-relaxed bg-[#1E191D] text-slate-100 focus:outline-none resize-none overflow-y-auto"
                  />
                </div>
              )}

              {/* Rendered GitHub + Obsidian Preview Pane */}
              {(viewMode === "rendered" || viewMode === "split") && (
                <div className="h-full overflow-y-auto p-6 sm:p-8 bg-white">
                  <div className="max-w-4xl mx-auto space-y-4">
                    {/* Obsidian Frontmatter Properties Card */}
                    {Object.keys(parsed.properties).length > 0 && (
                      <div className="mb-6 rounded-2xl border-2 border-[#FFD8C7] bg-[#FFFDFB] overflow-hidden shadow-2xs">
                        <div className="px-4 py-2 bg-[#FFF4EE] border-b border-[#FFD8C7] flex items-center justify-between">
                          <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#2B2129] flex items-center gap-1.5">
                            <Bookmark className="w-3.5 h-3.5 text-[#FF7F50]" />
                            Obsidian YAML Frontmatter Properties
                          </span>
                          <span className="text-[10.5px] font-mono text-[#5C4E58]">
                            --- metadata ---
                          </span>
                        </div>
                        <div className="divide-y divide-[#F5E6DF] text-xs">
                          {Object.entries(parsed.properties).map(([k, v]) => (
                            <div
                              key={k}
                              className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4"
                            >
                              <span className="w-32 font-mono font-bold text-[#5C4E58] flex-shrink-0">
                                {k}
                              </span>
                              <div className="flex flex-wrap items-center gap-1.5 text-[#2B2129] font-medium">
                                {Array.isArray(v)
                                  ? v.map((item, idx) => (
                                      <span key={idx}>
                                        {renderInlineMarkdown(item, `prop-${k}-${idx}`)}
                                      </span>
                                    ))
                                  : renderInlineMarkdown(String(v), `prop-${k}`)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Rendered Markdown Body */}
                    <article className="space-y-2">
                      {renderMarkdownBlocks(parsed.body)}
                    </article>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom Status & Secondary Actions Bar */}
        <div className="px-6 py-3 bg-[#FFF4EE] border-t border-[#FFD8C7] flex flex-wrap items-center justify-between gap-3 text-xs text-[#5C4E58]">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-bold text-[#2B2129] flex items-center gap-1.5">
              <FolderOpen className="w-3.5 h-3.5 text-[#FF7F50]" />
              Session Folder:{" "}
              <code className="font-mono bg-white px-2 py-0.5 rounded border border-[#FFD8C7] text-[#2B2129]">
                {folderPath || `/tmp/quorum-recordings/${meetingId}`}
              </code>
            </span>
            <span className="hidden md:inline text-[11px]">
              Supports Obsidian <code className="font-mono">[[Wikilinks]]</code>,{" "}
              <code className="font-mono">&gt; [!CALLOUTS]</code>,{" "}
              <code className="font-mono">==Highlights==</code>, YAML Properties &amp; GitHub GFM Tables/Task Lists
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <a
              href={api.getMarkdownDownloadUrl(meetingId)}
              download={`meeting_notes_${meetingId}.md`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-white hover:bg-[#FFFDFB] text-[#2B2129] border border-[#FFD8C7] transition-colors"
            >
              <FileDown className="w-3.5 h-3.5 text-[#FF7F50]" />
              <span>Export .md File</span>
            </a>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-xl text-xs font-extrabold bg-[#2B2129] text-white hover:opacity-90 transition-opacity"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalNode, document.body);
}
