"use client";

import { useState, useEffect, useCallback } from "react";

type ServiceType = { id: string; name: string; isCustom: boolean };

export default function NexupSettingsPage() {
  const [services, setServices] = useState<ServiceType[]>([]);
  const [loading, setLoading] = useState(true);
  const [newService, setNewService] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const fetchServices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/services?businessSlug=nexup");
      if (res.ok) setServices(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchServices(); }, [fetchServices]);

  const addService = async () => {
    if (!newService.trim()) return;
    await fetch("/api/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newService.trim(), businessSlug: "nexup" }) });
    setNewService("");
    fetchServices();
  };

  const updateService = async (id: string) => {
    if (!editName.trim()) return;
    await fetch(`/api/services/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editName.trim() }) });
    setEditing(null);
    fetchServices();
  };

  const deleteService = async (id: string) => {
    await fetch(`/api/services/${id}`, { method: "DELETE" });
    setConfirmDelete(null);
    fetchServices();
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", margin: 0 }}>⚙️ إعدادات NEXUP</h1>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>إدارة الخدمات وإعدادات النشاط</p>
      </div>

      {/* Services Section */}
      <div style={{ padding: 24, borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)", marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: 0 }}>🎨 الخدمات المتاحة</h2>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>إدارة قائمة خدمات التصميم المتوفرة</p>
          </div>
        </div>

        {/* Add Service Form */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input
            value={newService}
            onChange={e => setNewService(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addService()}
            placeholder="إضافة خدمة جديدة..."
            style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13, outline: "none" }}
          />
          <button onClick={addService} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "#0d9488", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>إضافة</button>
        </div>

        {loading ? (
          <p style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>جاري التحميل...</p>
        ) : services.length === 0 ? (
          <p style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>لا توجد خدمات بعد</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {services.map(s => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 8, background: "var(--surface-hover)", transition: "background 0.15s" }}>
                <span style={{ fontSize: 14 }}>🎨</span>
                {editing === s.id ? (
                  <>
                    <input value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => e.key === "Enter" && updateService(s.id)} autoFocus style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid #0d9488", background: "var(--bg)", color: "var(--text)", fontSize: 13, outline: "none" }} />
                    <button onClick={() => updateService(s.id)} style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: "#0d9488", color: "#fff", fontSize: 11, cursor: "pointer" }}>حفظ</button>
                    <button onClick={() => setEditing(null)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer" }}>إلغاء</button>
                  </>
                ) : (
                  <>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{s.name}</span>
                    {s.isCustom && <span style={{ padding: "2px 8px", borderRadius: 10, background: "rgba(59,130,246,0.1)", color: "#3b82f6", fontSize: 10, fontWeight: 600 }}>مخصصة</span>}
                    <button onClick={() => { setEditing(s.id); setEditName(s.name); }} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer" }}>✏️</button>
                    {confirmDelete === s.id ? (
                      <>
                        <button onClick={() => deleteService(s.id)} style={{ padding: "4px 8px", borderRadius: 4, border: "none", background: "#ef4444", color: "#fff", fontSize: 11, cursor: "pointer" }}>تأكيد</button>
                        <button onClick={() => setConfirmDelete(null)} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer" }}>إلغاء</button>
                      </>
                    ) : (
                      <button onClick={() => setConfirmDelete(s.id)} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)", color: "#ef4444", fontSize: 11, cursor: "pointer" }}>🗑</button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Business Info */}
      <div style={{ padding: 24, borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)" }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: "0 0 16px" }}>📋 معلومات النشاط</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ padding: 16, borderRadius: 10, background: "var(--surface-hover)" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>اسم النشاط</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>NEXUP</div>
          </div>
          <div style={{ padding: 16, borderRadius: 10, background: "var(--surface-hover)" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>نوع النشاط</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>تصميم جرافيك وهوية بصرية</div>
          </div>
          <div style={{ padding: 16, borderRadius: 10, background: "var(--surface-hover)" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>العملة</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>ريال سعودي → جنيه مصري</div>
          </div>
          <div style={{ padding: 16, borderRadius: 10, background: "var(--surface-hover)" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>نظام السحب</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>عمولة 10% عند التحويل</div>
          </div>
        </div>
      </div>
    </div>
  );
}
