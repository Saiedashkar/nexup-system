"use client";

import { useState, useEffect, useCallback } from "react";

type ServiceType = { id: string; name: string; isCustom: boolean };

export default function ReboundSettingsPage() {
  const [services, setServices] = useState<ServiceType[]>([]);
  const [loading, setLoading] = useState(true);
  const [newService, setNewService] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const fetchServices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/services?businessSlug=rebound");
      if (res.ok) setServices(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchServices(); }, [fetchServices]);

  const addService = async () => {
    if (!newService.trim()) return;
    await fetch("/api/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newService.trim(), businessSlug: "rebound" }) });
    setNewService(""); fetchServices();
  };

  const updateService = async (id: string) => {
    if (!editName.trim()) return;
    await fetch(`/api/services/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editName.trim() }) });
    setEditing(null); fetchServices();
  };

  const deleteService = async (id: string) => {
    await fetch(`/api/services/${id}`, { method: "DELETE" });
    setConfirmDelete(null); fetchServices();
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", margin: 0 }}>⚙️ إعدادات REBOUND</h1>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>إدارة الخدمات وإعدادات النشاط</p>
      </div>

      <div style={{ padding: 24, borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)", marginBottom: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: 0 }}>📢 الخدمات المتاحة</h2>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>إدارة قائمة خدمات التسويق والتصميم</p>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input value={newService} onChange={e => setNewService(e.target.value)} onKeyDown={e => e.key === "Enter" && addService()} placeholder="إضافة خدمة جديدة..." style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13, outline: "none" }} />
          <button onClick={addService} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "#2563eb", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>إضافة</button>
        </div>

        {loading ? <p style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>جاري التحميل...</p> : services.length === 0 ? (
          <p style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>لا توجد خدمات بعد</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {services.map(s => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 8, background: "var(--surface-hover)" }}>
                <span style={{ fontSize: 14 }}>📢</span>
                {editing === s.id ? (
                  <>
                    <input value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => e.key === "Enter" && updateService(s.id)} autoFocus style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid #2563eb", background: "var(--bg)", color: "var(--text)", fontSize: 13, outline: "none" }} />
                    <button onClick={() => updateService(s.id)} style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: "#2563eb", color: "#fff", fontSize: 11, cursor: "pointer" }}>حفظ</button>
                    <button onClick={() => setEditing(null)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer" }}>إلغاء</button>
                  </>
                ) : (
                  <>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{s.name}</span>
                    <button onClick={() => { setEditing(s.id); setEditName(s.name); }} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer" }}>✏️</button>
                    {confirmDelete === s.id ? (
                      <>
                        <button onClick={() => deleteService(s.id)} style={{ padding: "4px 8px", borderRadius: 4, border: "none", background: "#ef4444", color: "#fff", fontSize: 11, cursor: "pointer" }}>تأكيد</button>
                        <button onClick={() => setConfirmDelete(null)} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer" }}>إلغاء</button>
                      </>
                    ) : <button onClick={() => setConfirmDelete(s.id)} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)", color: "#ef4444", fontSize: 11, cursor: "pointer" }}>🗑</button>}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: 24, borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)" }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: "0 0 16px" }}>📋 معلومات النشاط</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {[{ l: "اسم النشاط", v: "REBOUND" }, { l: "نوع النشاط", v: "تسويق رقمي وطباعة" }, { l: "العملة", v: "جنيه مصري (EGP) مباشر" }, { l: "نظام الدفع", v: "بدون عمولة تحويل عملة" }].map((item, i) => (
            <div key={i} style={{ padding: 16, borderRadius: 10, background: "var(--surface-hover)" }}>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{item.l}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{item.v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
