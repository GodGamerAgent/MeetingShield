"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import { Send, Sparkles, Clock, Bot, User, Brain, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";

interface ChatMessage {
  id: string;
  sender: "user" | "bot";
  text: string;
  thought?: string;
  citations?: string[];
  timestamp: string;
}

interface MeetingChatbotProps {
  meetingId: string;
  meetingTitle?: string;
  attendees?: string[];
  onCitationClick?: (timestamp: string) => void;
}

export default function MeetingChatbot({
  meetingId,
  meetingTitle,
  attendees = [],
  onCitationClick,
}: MeetingChatbotProps) {
  const getInitialMessage = (title?: string): ChatMessage => ({
    id: "welcome",
    sender: "bot",
    text: `I am your Gemma 4 Meeting Intelligence Copilot${
      title ? ` for "${title}"` : ""
    }. Ask me about key decisions, action items, speaker commitments, rejected alternatives, or your behavioral coaching audit.`,
    timestamp: "",
  });

  const [messages, setMessages] = useState<ChatMessage[]>([
    getInitialMessage(meetingTitle),
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isThinkingEnabled, setIsThinkingEnabled] = useState(true);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Reset welcome message when switching meetings
  useEffect(() => {
    const nowTime = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    setMessages([
      {
        ...getInitialMessage(meetingTitle),
        timestamp: nowTime,
      },
    ]);
    setInput("");
  }, [meetingId, meetingTitle]);

  // Scroll only inside the chat message container (never hijack page scroll)
  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages, loading]);

  const quickPrompts = useMemo(() => {
    const firstColleague = attendees
      .map((a) => a.replace(/\s*\(.*?\)\s*/g, "").trim())
      .find((a) => a && a.toLowerCase() !== "robin" && a.toLowerCase() !== "me");

    return [
      "Catch me up on key decisions",
      "What are the action items and deadlines?",
      firstColleague
        ? `What did ${firstColleague} say & commit to?`
        : "What promises & commitments were made?",
      "How did I come across? Give me coaching",
      "Who spoke the most in this meeting?",
      "What alternatives were rejected?",
    ];
  }, [attendees]);

  const handleSend = async (queryToSend?: string) => {
    const q = (queryToSend ?? input).trim();
    if (!q || loading) return;

    const nowTime = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: "user",
      text: q,
      timestamp: nowTime,
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!queryToSend) setInput("");
    setLoading(true);

    try {
      const res = await api.askChat(meetingId, q, isThinkingEnabled);
      const botMsg: ChatMessage = {
        id: `b-${Date.now()}`,
        sender: "bot",
        text: res?.response || "No response received for this query.",
        thought: res?.thought || "",
        citations: res?.citations || [],
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `b-err-${Date.now()}`,
          sender: "bot",
          text: "Could not reach the meeting intelligence endpoint. Please try again.",
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleClearChat = () => {
    setMessages([
      {
        ...getInitialMessage(meetingTitle),
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      },
    ]);
  };

  // Render response with clickable [HH:MM:SS] badges and clean bold text
  const renderFormattedText = (text: string) => {
    const tokens = text.split(/(\[\d{2}:\d{2}:\d{2}\]|\*\*[^*]+\*\*)/g);
    return tokens.map((part, i) => {
      if (/^\[\d{2}:\d{2}:\d{2}\]$/.test(part)) {
        const rawTime = part.replace(/[\[\]]/g, "");
        return (
          <button
            key={i}
            type="button"
            onClick={() => onCitationClick && onCitationClick(rawTime)}
            className="inline-flex items-center gap-1 mx-1 px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold bg-white text-aura-coral border border-aura-pastel hover:bg-aura-mist cursor-pointer"
            title="Click to jump to transcript timestamp"
          >
            <Clock className="w-3 h-3" />
            {part}
          </button>
        );
      }
      if (/^\*\*[^*]+\*\*$/.test(part)) {
        return (
          <strong key={i} className="font-extrabold text-aura-charcoal">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="flex flex-col h-full bg-white/95 backdrop-blur-md rounded-3xl border border-aura-pastel/80 card-3d overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-aura-border bg-aura-mist/40">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-gradient-to-tr from-aura-peach to-aura-coral text-white shadow-sm">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-aura-charcoal uppercase tracking-wider">
              Meeting Chatbot
            </h3>
            <p className="text-[10px] text-aura-slate">
              Gemma 4 Grounded Q&amp;A · Click [HH:MM:SS] to jump
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Thinking Mode Toggle Switch */}
          <button
            type="button"
            onClick={() => setIsThinkingEnabled((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-bold border cursor-pointer ${
              isThinkingEnabled
                ? "bg-purple-100 text-purple-800 border-purple-300 ring-1 ring-purple-300"
                : "bg-white text-aura-slate border-aura-pastel hover:text-aura-charcoal hover:border-aura-peach"
            }`}
            title="Toggle Gemma 4 Chain-of-Thought Deep Thinking"
          >
            <Brain
              className={`w-3.5 h-3.5 ${
                isThinkingEnabled ? "text-purple-600" : "text-aura-slate"
              }`}
            />
            <span>Thinking: {isThinkingEnabled ? "ON" : "OFF"}</span>
          </button>

          <button
            type="button"
            onClick={handleClearChat}
            className="p-1.5 rounded-lg bg-white text-aura-slate hover:text-aura-coral border border-aura-pastel cursor-pointer"
            title="Reset conversation"
            aria-label="Reset chat conversation"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Quick Prompts */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2.5 border-b border-aura-border/60 bg-white/70">
        {quickPrompts.map((p, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => handleSend(p)}
            disabled={loading}
            className="text-[10.5px] font-semibold px-2.5 py-1 rounded-xl bg-aura-mist/80 text-aura-charcoal border border-aura-pastel hover:border-aura-coral hover:bg-white btn-3d-light disabled:opacity-50"
          >
            {p}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-3.5"
      >
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex items-start gap-2.5 ${
              m.sender === "user" ? "flex-row-reverse" : ""
            }`}
          >
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
                m.sender === "user"
                  ? "bg-aura-coral text-white font-bold"
                  : "bg-aura-mist text-aura-coral border border-aura-pastel"
              }`}
            >
              {m.sender === "user" ? (
                <User className="w-4 h-4" />
              ) : (
                <Bot className="w-4 h-4" />
              )}
            </div>
            <div
              className={`max-w-[86%] rounded-2xl p-3 text-xs leading-relaxed shadow-xs ${
                m.sender === "user"
                  ? "bg-gradient-to-r from-aura-peach to-aura-coral text-white rounded-tr-none"
                  : "bg-aura-mist/70 text-aura-charcoal border border-aura-pastel/70 rounded-tl-none"
              }`}
            >
              {m.thought && (
                <details
                  open
                  className="mb-2 p-2 rounded-xl bg-purple-50/90 border border-purple-200/90 text-[11px] cursor-pointer group"
                >
                  <summary className="font-bold text-purple-900 flex items-center gap-1.5 select-none hover:text-purple-700">
                    <Brain className="w-3.5 h-3.5 text-purple-600" />
                    <span>Gemma 4 Chain-of-Thought Reasoning</span>
                  </summary>
                  <div className="mt-1.5 pt-1.5 border-t border-purple-200/60 font-mono text-[10.5px] text-purple-950/85 whitespace-pre-wrap leading-relaxed pl-1">
                    {m.thought}
                  </div>
                </details>
              )}
              <div className="whitespace-pre-line">
                {m.sender === "bot" ? renderFormattedText(m.text) : m.text}
              </div>
              {m.timestamp && (
                <div
                  suppressHydrationWarning
                  className={`text-[9.5px] mt-1.5 ${
                    m.sender === "user"
                      ? "text-white/80 text-right"
                      : "text-aura-slate"
                  }`}
                >
                  {m.timestamp}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-aura-slate text-xs animate-pulse p-2">
            <Bot className="w-4 h-4 text-aura-coral" />
            <span>Synthesizing answer from meeting memory via Gemma 4...</span>
          </div>
        )}
      </div>

      {/* Input row */}
      <div className="p-3 border-t border-aura-border bg-white/95">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about decisions, tasks, speakers, or coaching..."
            aria-label="Ask Meeting Chatbot"
            className="flex-1 px-3.5 py-2.5 text-xs rounded-xl border border-aura-pastel bg-aura-mist/40 text-aura-charcoal focus:outline-none focus:border-aura-coral focus:bg-white transition-colors"
          />
          <button
            type="submit"
            onClick={() => handleSend()}
            disabled={!input.trim() || loading}
            aria-label="Send message"
            className="px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-aura-peach to-aura-coral text-white font-bold text-xs flex items-center gap-1.5 btn-3d disabled:opacity-40"
          >
            <Send className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Ask</span>
          </button>
        </form>
      </div>
    </div>
  );
}
