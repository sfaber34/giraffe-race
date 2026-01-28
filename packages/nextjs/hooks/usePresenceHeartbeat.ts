"use client";

import { useEffect, useRef } from "react";

// Generate a unique visitor ID per browser session
function getVisitorId(): string {
  if (typeof window === "undefined") return "";

  let id = sessionStorage.getItem("raffe-visitor-id");
  if (!id) {
    id = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    sessionStorage.setItem("raffe-visitor-id", id);
  }
  return id;
}

/**
 * Hook that sends presence heartbeats to track active users.
 * Only sends heartbeats when the page is visible.
 *
 * @param intervalMs - How often to send heartbeats (default: 15 seconds)
 */
export function usePresenceHeartbeat(intervalMs = 15_000) {
  const visitorIdRef = useRef<string>("");

  useEffect(() => {
    visitorIdRef.current = getVisitorId();
    if (!visitorIdRef.current) return;

    let isVisible = !document.hidden;

    const sendHeartbeat = async () => {
      if (!isVisible || !visitorIdRef.current) return;

      try {
        await fetch("/api/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visitorId: visitorIdRef.current }),
        });
      } catch {
        // Silently fail - presence is best-effort
      }
    };

    // Send initial heartbeat
    sendHeartbeat();

    // Set up interval
    const intervalId = setInterval(sendHeartbeat, intervalMs);

    // Track visibility changes
    const handleVisibilityChange = () => {
      isVisible = !document.hidden;
      if (isVisible) {
        // Send heartbeat immediately when becoming visible
        sendHeartbeat();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [intervalMs]);
}
