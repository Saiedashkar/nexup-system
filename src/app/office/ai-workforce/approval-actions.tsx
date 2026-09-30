"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Approve / Reject control for one pending approval.
 *
 * The smallest possible client component: it posts a decision and refreshes the
 * server component. It holds no authority — every decision is re-authorised and
 * re-policy-checked on the server, and the engine's compare-and-set makes a
 * double click a no-op rather than a second execution.
 */
export function ApprovalActions({ approvalId, canDecide }: { approvalId: string; canDecide: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    setMessage(null);
    try {
      const response = await fetch(`/api/ai-workforce/approvals/${approvalId}/${decision}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: decision === "approve" ? "موافقة بشرية من الواجهة" : "رفض بشري من الواجهة" }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { decision?: string; jobStatus?: string; idempotent?: boolean; error?: string; message?: string }
        | null;

      if (!response.ok) {
        setMessage(`${payload?.error ?? "ERROR"}: ${payload?.message ?? response.statusText}`);
      } else {
        const suffix = payload?.idempotent ? " (سابقًا)" : "";
        setMessage(`${decision === "approve" ? "تمت الموافقة" : "تم الرفض"}${suffix} — الحالة: ${payload?.jobStatus ?? "—"}`);
      }
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "فشل الطلب");
    } finally {
      setBusy(null);
    }
  }

  const base: React.CSSProperties = {
    border: "1px solid #cbd5f5",
    borderRadius: 8,
    padding: "6px 12px",
    fontSize: 13,
    fontWeight: 700,
    cursor: canDecide && !busy ? "pointer" : "not-allowed",
    opacity: canDecide && !busy ? 1 : 0.5,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          disabled={!canDecide || busy !== null}
          onClick={() => decide("approve")}
          style={{ ...base, background: "#10b981", color: "#ffffff" }}
        >
          {busy === "approve" ? "..." : "Approve"}
        </button>
        <button
          type="button"
          disabled={!canDecide || busy !== null}
          onClick={() => decide("reject")}
          style={{ ...base, background: "#ffffff", color: "#b91c1c" }}
        >
          {busy === "reject" ? "..." : "Reject"}
        </button>
      </div>
      {!canDecide && (
        <span style={{ fontSize: 11, color: "#b45309" }}>لا تملك صلاحية اتخاذ هذا القرار</span>
      )}
      {message && <span style={{ fontSize: 11, color: "#475569" }}>{message}</span>}
    </div>
  );
}
