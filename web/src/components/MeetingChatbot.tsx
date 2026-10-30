"use client";

import React, { useState, useRef, useEffect } from "react";
import { Send, Sparkles, Clock, MessageSquare, Bot, User, Brain } from "lucide-react";
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
  onCitationClick?: (timestamp: string) => void;
}

export default function MeetingChatbot({ meetingId, onCitationClick }: MeetingChatbotProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      sender: "bot",
      text: "I am your Gemma 4 Meeting Intelligence Copilot. Ask anything about decisions, numbers, commitments, or deadlines from this meeting.",
      timestamp: ""
    }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isThinkingEnabled, setIsThinkingEnabled] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Populate client-side timestamp after mount to guarantee hydration match
    setMessages(prev =>
      prev.map(m => m.id === "welcome" && !m.timestamp ? {
        ...m,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      } : m)
    );
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const quickPrompts = [
    "What did we agree on for the SLA deadline?",
    "What were the cloud budget savings?",
    "Catch me up on key decisions",
    "What are my assigned action items?"
  ];

  const handleSend = async (queryToSend?: string) => {
    const q = queryToSend || input.trim();
    if (!q || loading) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: "user",
      text: q,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    if (!queryToSend) setInput("");
    setLoading(true);

    try {
      const res = await api.askChat(meetingId, q, isThinkingEnabled);
      const botMsg: ChatMessage = {
        id: `b-${Date.now()}`,
        sender: "bot",
        text: res.response || "No response received.",
        thought: res.thought || "",
        citations: res.citations || [],
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, botMsg]);
    } catch (e) {
      setMessages(prev => [
        ...prev,
        {
          id: `b-err-${Date.now()}`,
          sender: "bot",
          text: "Could not connect to Gemma 4 / LM Studio. Check server connection in Settings.",
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  // Render response with clickable [HH:MM:SS] badges
  const renderFormattedText = (text: string) => {
    const parts = text.split(/(\[\d{2}:\d{2}:\d{2}\])/g);
    return parts.map((part, i) => {
      if (/^\[\d{2}:\d{2}:\d{2}\]$/.test(part)) {
        const rawTime = part.replace(/[\[\]]/g, "");
        return (
          <button
            key={i}
            onClick={() => onCitationClick && onCitationClick(rawTime)}
            className="inline-flex items-center gap-1 mx-1 px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold bg-aura-mist text-aura-coral border border-aura-pastel hover:bg-aura-pastel/80 transition-colors shadow-xs"
            title="Click to jump to transcript timestamp"
          >
            <Clock className="w-3 h-3" />
            {part}
          </button>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="flex flex-col h-full bg-white/90 backdrop-blur-md rounded-2xl border border-aura-pastel/70 shadow-peach-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-aura-border bg-aura-mist/40">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-gradient-to-tr from-aura-peach to-aura-coral text-white shadow-sm">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-aura-charcoal uppercase tracking-wider">
              Meeting Chatbot
            </h3>
            <p className="text-[10px] text-aura-slate">Instant answers & exact quotes</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Thinking Mode Toggle Switch */}
          <button
            onClick={() => setIsThinkingEnabled(!isThinkingEnabled)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-bold transition-all border ${
              isThinkingEnabled
                ? "bg-purple-100 text-purple-800 border-purple-300 shadow-xs ring-1 ring-purple-300"
                : "bg-white text-aura-slate border-aura-pastel hover:text-aura-charcoal hover:border-aura-peach"
            }`}
            title="Toggle Gemma 4 Chain-of-Thought Deep Thinking"
          >
            <Brain className={`w-3.5 h-3.5 ${isThinkingEnabled ? "text-purple-600 animate-pulse" : "text-aura-slate"}`} />
            <span>Thinking: {isThinkingEnabled ? "ON" : "OFF"}</span>
          </button>

          <span className="text-[10px] font-bold text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full border border-purple-200 hidden sm:inline-block">
            Gemma 4
          </span>
        </div>
      </div>

      {/* Quick Prompts */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-aura-border/60 overflow-x-auto no-scrollbar bg-white/50">
        {quickPrompts.map((p, idx) => (
          <button
            key={idx}
            onClick={() => handleSend(p)}
            className="text-[10.5px] whitespace-nowrap px-2.5 py-1 rounded-full bg-aura-mist text-aura-charcoal border border-aura-pastel/80 hover:border-aura-peach hover:bg-white transition-all shadow-xs"
          >
            {p}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex items-start gap-2.5 ${m.sender === "user" ? "flex-row-reverse" : ""}`}
          >
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
                m.sender === "user"
                  ? "bg-aura-coral text-white font-bold"
                  : "bg-aura-mist text-aura-coral border border-aura-pastel"
              }`}
            >
              {m.sender === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>
            <div
              className={`max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed shadow-xs ${
                m.sender === "user"
                  ? "bg-gradient-to-r from-aura-peach to-aura-coral text-white rounded-tr-none"
                  : "bg-aura-mist/70 text-aura-charcoal border border-aura-pastel/60 rounded-tl-none"
              }`}
            >
              {m.thought && (
                <details className="mb-2 p-2 rounded-xl bg-purple-50/80 border border-purple-200/90 text-[11px] cursor-pointer group">
                  <summary className="font-bold text-purple-900 flex items-center gap-1.5 select-none hover:text-purple-700">
                    <Brain className="w-3.5 h-3.5 text-purple-600 animate-pulse" />
                    <span>Gemma 4 Thinking Process</span>
                  </summary>
                  <div className="mt-1.5 pt-1.5 border-t border-purple-200/60 font-mono text-[10.5px] text-purple-950/80 whitespace-pre-wrap leading-relaxed pl-1">
                    {m.thought}
                  </div>
                </details>
              )}
              <div>{m.sender === "bot" ? renderFormattedText(m.text) : m.text}</div>
              {m.timestamp && (
                <div
                  suppressHydrationWarning
                  className={`text-[9.5px] mt-1.5 ${
                    m.sender === "user" ? "text-white/80 text-right" : "text-aura-slate"
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
            <span>Consulting meeting memory via Gemma 4...</span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input row */}
      <div className="p-3 border-t border-aura-border bg-white/80">
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
            placeholder="Ask about this meeting (e.g. What did we decide?)..."
            className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-aura-pastel bg-aura-mist/40 text-aura-charcoal focus:outline-none focus:border-aura-coral focus:bg-white transition-all shadow-inner"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="p-2 rounded-xl bg-gradient-to-r from-aura-peach to-aura-coral text-white disabled:opacity-40 hover:opacity-95 shadow-sm transition-all"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
