"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/* ═══════════════════════════════════════════════════════
   Undo toast
   After any safe delete, a toast appears for a few seconds with
   a "تراجع ↩" button. Ctrl+Z / Cmd+Z does the same thing, but only
   while the toast is visible — so it can never undo something older.
   ═══════════════════════════════════════════════════════ */

export type UndoAction = {
  /** Prisma model name, e.g. "Subscription" */
  model: string;
  id: string;
  /** Human label shown in the toast */
  label: string;
  /** Called after a successful restore (usually a list refresh) */
  onRestored?: () => void;
};

type UndoContextValue = {
  showUndo: (action: UndoAction) => void;
};

const UndoContext = createContext<UndoContextValue>({ showUndo: () => {} });

export function useUndo() {
  return useContext(UndoContext);
}

const UNDO_WINDOW_MS = 10000;

export function UndoProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<UndoAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    setPending(null);
  }, [clearTimer]);

  const showUndo = useCallback(
    (action: UndoAction) => {
      clearTimer();
      setMessage(null);
      setPending(action);
      timerRef.current = setTimeout(() => setPending(null), UNDO_WINDOW_MS);
    },
    [clearTimer],
  );

  const undo = useCallback(async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/recycle-bin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: pending.model, id: pending.id }),
      });
      if (res.ok) {
        pending.onRestored?.();
        dismiss();
      } else {
        setMessage("تعذّر التراجع — يمكنك المحاولة من سلة المحذوفات");
      }
    } catch {
      setMessage("تعذّر التراجع — تحقق من الاتصال");
    }
    setBusy(false);
  }, [pending, busy, dismiss]);

  // Ctrl+Z / Cmd+Z — scoped to the visible toast window only
  useEffect(() => {
    if (!pending) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void undo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending, undo]);

  useEffect(() => clearTimer, [clearTimer]);

  return (
    <UndoContext.Provider value={{ showUndo }}>
      {children}

      {pending && (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 5000,
            display: "flex",
            alignItems: "center",
            gap: 12,
            maxWidth: "min(92vw, 560px)",
            padding: "12px 16px",
            borderRadius: 12,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.28)",
          }}
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>🗑</span>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
              تم الحذف: {pending.label}
            </div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
              {message ?? "يمكنك التراجع الآن — أو Ctrl+Z"}
            </div>
          </div>

          <button
            onClick={() => void undo()}
            disabled={busy}
            style={{
              padding: "7px 14px",
              borderRadius: 8,
              border: "none",
              background: "#3b82f6",
              color: "#fff",
              fontSize: 12,
              fontWeight: 700,
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.6 : 1,
              whiteSpace: "nowrap",
            }}
          >
            {busy ? "..." : "تراجع ↩"}
          </button>

          <button
            onClick={dismiss}
            aria-label="إغلاق"
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              border: "none",
              background: "var(--surface-hover)",
              color: "var(--muted)",
              fontSize: 12,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>
      )}
    </UndoContext.Provider>
  );
}
