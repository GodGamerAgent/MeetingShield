"use client";

import { useEffect, useRef } from "react";
import { WS_BASE } from "@/lib/api";

export interface LiveEvent {
  type: string;
  meeting_id?: string;
  [key: string]: any;
}

/** Subscribes to backend /ws/live events (recording levels, processing progress) with auto-reconnect. */
export function useLiveEvents(onEvent: (event: LiveEvent) => void) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!WS_BASE) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;

    const connect = () => {
      try {
        ws = new WebSocket(`${WS_BASE}/ws/live`);
        ws.onopen = () => {
          ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 20000);
        };
        ws.onmessage = (e) => {
          try {
            handlerRef.current(JSON.parse(e.data));
          } catch {
            /* pong / non-JSON */
          }
        };
        ws.onclose = () => {
          if (ping) clearInterval(ping);
          if (!closed) retry = setTimeout(connect, 3000);
        };
      } catch {
        /* ignore ws init failure */
      }
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      if (ping) clearInterval(ping);
      ws?.close();
    };
  }, []);
}
