"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type RecycleBinItem = {
  model: string;
  entityType: string;
  labelAr: string;
  id: string;
  description: string;
  deletedAt: string;
  deletedByUserId: string | null;
  deletedByName: string | null;
};

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function RecycleBinPage() {
  const [items, setItems] = useState<RecycleBinItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<string | null>(null);
  const [purgeConfirmText, setPurgeConfirmText] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [flash, setFlash] = useState("");

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/recycle-bin", { cache: "no-store" });
      if (res.status === 403) {
        setError("هذه الصفحة متاحة للسوبر أدمن فقط");
        setItems([]);
      } else if (!res.ok) {
        setError("تعذّر تحميل سلة المحذوفات");
      } else {
        const data = await res.json();
        setItems(data.items || []);
      }
    } catch {
      setError("تعذّر تحميل سلة المحذوفات");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const showFlash = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(""), 3000);
  };

  const restore = async (item: RecycleBinItem) => {
    setBusyId(item.id);
    try {
      const res = await fetch("/api/recycle-bin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: item.model, id: item.id }),
      });
      if (res.ok) {
        showFlash(`✅ تم استعادة: ${item.labelAr} — ${item.description}`);
        await fetchItems();
      } else {
        showFlash("❌ تعذّرت الاستعادة");
      }
    } catch {
      showFlash("❌ تعذّرت الاستعادة");
    }
    setBusyId(null);
  };

  const purge = async (item: RecycleBinItem) => {
    setBusyId(item.id);
    try {
      const res = await fetch("/api/recycle-bin", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: item.model, id: item.id, confirm: true }),
      });
      if (res.ok) {
        showFlash("🗑 تم الحذف النهائي");
        setPurgeTarget(null);
        setPurgeConfirmText("");
        await fetchItems();
      } else {
        const data = await res.json().catch(() => ({}));
        showFlash(`❌ ${data.error || "تعذّر الحذف النهائي"}`);
      }
    } catch {
      showFlash("❌ تعذّر الحذف النهائي");
    }
    setBusyId(null);
  };

  const types = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach(i => map.set(i.entityType, i.labelAr));
    return Array.from(map.entries());
  }, [items]);

  const filtered = typeFilter ? items.filter(i => i.entityType === typeFilter) : items;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", margin: 0 }}>
          🗑 سلة المحذوفات
        </h1>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>
          Recycle Bin — كل سجل محذوف يمكن استعادته. لا شيء يُحذف نهائيًا إلا من هنا.
        </p>
      </div>

      {flash && (
        <div
          style={{
            marginBottom: 14,
            padding: "10px 14px",
            borderRadius: 10,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text)",
          }}
        >
          {flash}
        </div>
      )}

      {/* Filter + refresh */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          style={{
            padding: "7px 10px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text)",
            fontSize: 11,
            outline: "none",
          }}
        >
          <option value="">كل الأنواع ({items.length})</option>
          {types.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <button
          onClick={fetchItems}
          style={{
            padding: "7px 14px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text)",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          تحديث
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>جاري التحميل...</div>
      ) : error ? (
        <div style={{ textAlign: "center", padding: 40, color: "#ef4444" }}>{error}</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>السلة فاضية</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
            لا يوجد أي سجل محذوف حاليًا
          </div>
        </div>
      ) : (
        <div style={{ borderRadius: 14, border: "1px solid var(--border)", overflow: "hidden" }}>
          {/* Header row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "140px 2fr 140px 160px 190px",
              padding: "12px 16px",
              background: "var(--surface)",
              borderBottom: "2px solid var(--border)",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--muted)",
            }}
          >
            <div>النوع</div>
            <div>الوصف</div>
            <div>من حذفه</div>
            <div>متى</div>
            <div style={{ textAlign: "center" }}>الإجراءات</div>
          </div>

          {filtered.map(item => {
            const key = `${item.model}:${item.id}`;
            const isPurgeTarget = purgeTarget === key;
            return (
              <div
                key={key}
                style={{
                  display: "grid",
                  gridTemplateColumns: "140px 2fr 140px 160px 190px",
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 12,
                  alignItems: "center",
                  background: isPurgeTarget ? "rgba(239,68,68,0.05)" : "transparent",
                }}
              >
                <div>
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: 6,
                      background: "var(--surface-hover)",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--text)",
                    }}
                  >
                    {item.labelAr}
                  </span>
                </div>

                <div style={{ color: "var(--text)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {item.description || "—"}
                </div>

                <div style={{ color: "var(--muted)", fontSize: 11 }}>
                  {item.deletedByName || "—"}
                </div>

                <div style={{ color: "var(--muted)", fontSize: 11, direction: "ltr" }}>
                  {fmtDateTime(item.deletedAt)}
                </div>

                <div style={{ display: "flex", gap: 6, justifyContent: "center", alignItems: "center" }}>
                  {isPurgeTarget ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "stretch" }}>
                      <div style={{ fontSize: 9, color: "#ef4444", fontWeight: 700, textAlign: "center" }}>
                        اكتب «حذف نهائي» للتأكيد — لا يمكن التراجع!
                      </div>
                      <input
                        value={purgeConfirmText}
                        onChange={e => setPurgeConfirmText(e.target.value)}
                        placeholder="حذف نهائي"
                        style={{
                          padding: "5px 8px",
                          borderRadius: 5,
                          border: "1px solid rgba(239,68,68,0.4)",
                          background: "var(--surface)",
                          color: "var(--text)",
                          fontSize: 11,
                          outline: "none",
                          width: 130,
                          textAlign: "center",
                        }}
                      />
                      <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                        <button
                          disabled={purgeConfirmText.trim() !== "حذف نهائي" || busyId === item.id}
                          onClick={() => purge(item)}
                          style={{
                            padding: "4px 10px",
                            borderRadius: 5,
                            border: "none",
                            background: "#ef4444",
                            color: "#fff",
                            fontSize: 10,
                            fontWeight: 700,
                            cursor: purgeConfirmText.trim() === "حذف نهائي" ? "pointer" : "not-allowed",
                            opacity: purgeConfirmText.trim() === "حذف نهائي" ? 1 : 0.45,
                          }}
                        >
                          حذف نهائي
                        </button>
                        <button
                          onClick={() => {
                            setPurgeTarget(null);
                            setPurgeConfirmText("");
                          }}
                          style={{
                            padding: "4px 10px",
                            borderRadius: 5,
                            border: "1px solid var(--border)",
                            background: "transparent",
                            color: "var(--muted)",
                            fontSize: 10,
                            cursor: "pointer",
                          }}
                        >
                          إلغاء
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        disabled={busyId === item.id}
                        onClick={() => restore(item)}
                        style={{
                          padding: "5px 12px",
                          borderRadius: 6,
                          border: "none",
                          background: "rgba(16,185,129,0.12)",
                          color: "#10b981",
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: "pointer",
                          opacity: busyId === item.id ? 0.6 : 1,
                        }}
                      >
                        استعادة ↩
                      </button>
                      {/* Intentionally low-key: permanent delete is not a primary action */}
                      <button
                        onClick={() => {
                          setPurgeTarget(key);
                          setPurgeConfirmText("");
                        }}
                        title="حذف نهائي (لا يمكن التراجع)"
                        style={{
                          padding: "4px 8px",
                          borderRadius: 6,
                          border: "1px solid var(--border)",
                          background: "transparent",
                          color: "var(--muted)",
                          fontSize: 10,
                          cursor: "pointer",
                          opacity: 0.55,
                        }}
                      >
                        حذف نهائي
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
