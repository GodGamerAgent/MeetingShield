"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Pin } from "lucide-react";
import { api, sortTodos, TodoItem } from "@/lib/api";
import { useLiveEvents } from "@/lib/useLiveEvents";

/** Tasks pinned from any meeting, kept on Home until they are unpinned. */
export default function PinnedTasks() {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTodos(await api.getPinnedTodos());
      setError(null);
    } catch {
      setError("Couldn't load pinned tasks.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useLiveEvents((ev) => {
    if (ev.type === "TODO_UPDATED" && ev.todo) {
      const todo: TodoItem = ev.todo;
      setTodos((prev) => {
        const rest = prev.filter((t) => t.id !== todo.id);
        return todo.pinned ? [...rest, todo] : rest;
      });
    } else if (["MEETING_DELETED", "SESSIONS_CLEARED", "MEETING_PROCESSED", "MEETING_UPDATED", "TODOS_REPLACED"].includes(ev.type)) {
      load(); // to-dos were removed, regenerated or their meeting renamed
    }
  });

  const update = async (action: Promise<{ todo: TodoItem }>) => {
    try {
      const { todo } = await action;
      setError(null);
      setTodos((prev) => {
        const rest = prev.filter((t) => t.id !== todo.id);
        return todo.pinned ? [...rest, todo] : rest;
      });
    } catch {
      setError("Couldn't update that task — is the backend running?");
    }
  };

  if (todos.length === 0 && !error) return null;

  const sorted = sortTodos(todos);
  const open = todos.filter((t) => !t.completed).length;

  return (
    <div className="rounded-3xl bg-white/85 border border-amber-200 p-4 sm:p-5 card-3d scroll-reveal">
      <div className="flex items-center justify-between px-1 pb-3">
        <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand-charcoal">
          <Pin className="w-3.5 h-3.5 text-amber-600 fill-current" />
          Pinned tasks
        </h2>
        <span className="text-[11px] font-semibold text-brand-slate">
          {open} open · {todos.length - open} done
        </span>
      </div>
      {error && <p className="px-1 pb-2 text-[11px] text-red-700">{error}</p>}
      <ul className="space-y-2">
        {sorted.map((t) => {
          const done = t.completed === 1;
          return (
            <li key={t.id} className={`flex items-start gap-3 p-3 rounded-2xl border ${done ? "bg-slate-50 border-slate-200 opacity-70" : "bg-white border-brand-pastel/80"}`}>
              <button
                onClick={() => update(api.toggleTodo(t.id))}
                aria-label={done ? "Mark as not done" : "Mark as done"}
                className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 mt-0.5 ${done ? "bg-brand-coral border-brand-coral text-white" : "border-brand-pastel bg-white hover:border-brand-peach"}`}
              >
                {done && <Check className="w-3.5 h-3.5" />}
              </button>
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-semibold leading-snug ${done ? "line-through text-brand-slate" : "text-brand-charcoal"}`}>{t.task}</p>
                <p className="text-[11px] text-brand-slate mt-0.5 truncate">
                  <span className="font-semibold text-brand-charcoal">{t.owner}</span>
                  {t.deadline ? ` · ${t.deadline}` : ""}
                  {" · "}
                  <Link href={`/meetings/${t.meeting_id}`} className="hover:text-brand-coral hover:underline">
                    {t.meeting_title || "Open meeting"}
                  </Link>
                </p>
              </div>
              <button
                onClick={() => update(api.pinTodo(t.id, false))}
                aria-label="Unpin task"
                title="Unpin"
                className="p-1 -m-1 rounded-md text-amber-600 hover:text-amber-700 flex-shrink-0"
              >
                <Pin className="w-3.5 h-3.5 fill-current" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
