import { useEffect, useRef, useState } from "react";

/** Reconnect sessions only; never replay the operation that detected a loss. */
export function useConnectionRecovery(options: {
  sessions: Record<string, string>;
  check: (session: string) => Promise<boolean>;
  reconnect: (key: string, session: string, isCurrent: () => boolean) => Promise<void>;
  onError: (message: string) => void;
  onExhausted?: (key: string, session: string) => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const exhausted = useRef(new Set<string>());
  const [recovering, setRecovering] = useState<string[]>([]);
  useEffect(() => {
    let disposed = false;
    const checking = new Set<string>();
    const timer = setInterval(() => {
      for (const [key, session] of Object.entries(latest.current.sessions)) {
        if (checking.has(session) || exhausted.current.has(session)) continue;
        checking.add(session);
        const isCurrent = () => !disposed && latest.current.sessions[key] === session;
        void (async () => {
          let recovering = false;
          try {
            let connected = false;
            try { connected = await latest.current.check(session); } catch { /* Treat failed health checks as a lost connection. */ }
            if (connected || !isCurrent()) return;
            recovering = true;
            setRecovering((previous) => [...previous, key]);
            let failure: unknown;
            for (let attempt = 0; attempt < 3 && isCurrent(); attempt++) {
              if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
              if (!isCurrent()) return;
              try {
                await latest.current.reconnect(key, session, isCurrent);
                return;
              } catch (error) { failure = error; }
            }
            if (isCurrent()) {
              exhausted.current.add(session);
              latest.current.onExhausted?.(key, session);
              latest.current.onError(`Connection lost. Reconnecting failed after 3 attempts. ${String(failure)}`);
            }
          } finally {
            checking.delete(session);
            if (!disposed && recovering) setRecovering((previous) => previous.filter((item) => item !== key));
          }
        })();
      }
    }, 5000);
    return () => { disposed = true; clearInterval(timer); };
  }, []);
  return { recovering, retry: (key: string) => {
    const session = latest.current.sessions[key];
    if (session) exhausted.current.delete(session);
  } };
}
