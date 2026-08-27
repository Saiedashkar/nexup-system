"use client";

import { useState, useEffect, useCallback } from "react";

type User = {
  id: string; name: string; email: string; role: string;
  canAccessNexup: boolean; canAccessRebound: boolean; canAccessAbomazen: boolean; canAccessOfficeFinanceFull: boolean;
  mustChangePassword: boolean; createdAt: string;
  business: { name: string; slug: string } | null;
};

const PERMISSION_LABELS: Record<string, { label: string; color: string }> = {
  canAccessNexup: { label: "NEXUP", color: "#0d9488" },
  canAccessRebound: { label: "REBOUND", color: "#2563eb" },
  canAccessAbomazen: { label: "ABOMAZEN", color: "#f59e0b" },
  canAccessOfficeFinanceFull: { label: "إدارة المكتب", color: "#8b5cf6" },
};

export default function UsersManagementPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showPasswordReset, setShowPasswordReset] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Form states
  const [form, setForm] = useState({ name: "", email: "", password: "Admin@12345" });
  const [permissions, setPermissions] = useState({ canAccessNexup: true, canAccessRebound: true, canAccessAbomazen: true, canAccessOfficeFinanceFull: true });
  const [pwForm, setPwForm] = useState({ newPassword: "", mustChangePassword: true });
  const [editForm, setEditForm] = useState({ name: "", email: "", role: "SUPER_ADMIN" });
  const [editPerms, setEditPerms] = useState({ canAccessNexup: true, canAccessRebound: true, canAccessAbomazen: true, canAccessOfficeFinanceFull: true });

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users");
      if (res.ok) setUsers(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const flash = (msg: string, isError = false) => {
    if (isError) setErrorMsg(msg); else setSuccessMsg(msg);
    setTimeout(() => { setSuccessMsg(""); setErrorMsg(""); }, 4000);
  };

  const addUser = async () => {
    if (!form.name || !form.email) { flash("الاسم والإيميل مطلوبين", true); return; }
    const res = await fetch("/api/admin/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, ...permissions }),
    });
    const data = await res.json();
    if (!res.ok) { flash(data.error || "خطأ في الإنشاء", true); return; }
    flash(`✅ تم إنشاء ${form.name} — كلمة المرور: ${form.password}`);
    setForm({ name: "", email: "", password: "Admin@12345" });
    setShowForm(false);
    fetchUsers();
  };

  const updateUser = async (id: string) => {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...editForm, ...editPerms }),
    });
    if (res.ok) { flash("✅ تم التحديث بنجاح"); setShowEdit(null); fetchUsers(); }
    else { flash("خطأ في التحديث", true); }
  };

  const resetPassword = async (id: string) => {
    if (!pwForm.newPassword || pwForm.newPassword.length < 6) { flash("كلمة المرور يجب 6 أحرف على الأقل", true); return; }
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pwForm),
    });
    const data = await res.json();
    if (res.ok) { flash(`✅ تم تغيير كلمة المرور — الجديدة: ${pwForm.newPassword}`); setShowPasswordReset(null); setPwForm({ newPassword: "", mustChangePassword: true }); }
    else { flash(data.error || "خطأ", true); }
  };

  const deleteUser = async (id: string) => {
    const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    if (res.ok) { flash("✅ تم الحذف"); setConfirmDelete(null); fetchUsers(); }
    else { flash("لا يمكن الحذف", true); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", margin: 0 }}>👥 إدارة المستخدمين</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>إضافة وتعديل وحذف المستخدمين وتحديد صلاحياتهم</p>
        </div>
        <button onClick={() => setShowForm(true)} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "#8b5cf6", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>＋ مستخدم جديد</button>
      </div>

      {/* Success/Error Messages */}
      {successMsg && <div style={{ padding: "12px 16px", borderRadius: 10, background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", color: "#10b981", fontSize: 13, fontWeight: 600, marginBottom: 16 }}>{successMsg}</div>}
      {errorMsg && <div style={{ padding: "12px 16px", borderRadius: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", fontSize: 13, fontWeight: 600, marginBottom: 16 }}>{errorMsg}</div>}

      {/* Add User Form */}
      {showForm && (
        <div style={{ padding: 24, borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)", marginBottom: 24 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: "0 0 16px" }}>مستخدم جديد</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>الاسم *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="مثال: MOATASEM" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13, outline: "none" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>الإيميل *</label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="user@nexup.local" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13, outline: "none" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>كلمة المرور *</label>
              <input type="text" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13, outline: "none" }} />
            </div>
          </div>

          {/* Permissions */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 8 }}>الصلاحيات</label>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {(Object.entries(PERMISSION_LABELS) as [string, { label: string; color: string }][]).map(([key, { label, color }]) => (
                <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: `1px solid ${permissions[key as keyof typeof permissions] ? color : "var(--border)"}`, background: permissions[key as keyof typeof permissions] ? `${color}15` : "transparent", cursor: "pointer", transition: "all 0.15s" }}>
                  <input type="checkbox" checked={permissions[key as keyof typeof permissions]} onChange={e => setPermissions(p => ({ ...p, [key]: e.target.checked }))} style={{ accentColor: color }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: permissions[key as keyof typeof permissions] ? color : "var(--muted)" }}>{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={addUser} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "#8b5cf6", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>إنشاء</button>
            <button onClick={() => setShowForm(false)} style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 13, cursor: "pointer" }}>إلغاء</button>
          </div>
        </div>
      )}

      {/* Users Table */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--muted)" }}>جاري التحميل...</div>
      ) : (
        <div style={{ borderRadius: 14, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 2fr 1fr repeat(4, 0.7fr) 0.5fr 1.2fr", padding: "12px 16px", background: "var(--surface)", borderBottom: "2px solid var(--border)", fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>
            <div>الاسم</div><div>الإيميل</div><div>الدور</div>
            <div style={{ textAlign: "center" }}>NEXUP</div><div style={{ textAlign: "center" }}>REBOUND</div><div style={{ textAlign: "center" }}>ABOMAZEN</div><div style={{ textAlign: "center" }}>المكتب</div>
            <div style={{ textAlign: "center" }}>⚡</div><div style={{ textAlign: "center" }}>الإجراءات</div>
          </div>

          {users.map(u => (
            <div key={u.id} style={{ display: "grid", gridTemplateColumns: "1.5fr 2fr 1fr repeat(4, 0.7fr) 0.5fr 1.2fr", padding: "12px 16px", borderBottom: "1px solid var(--border)", fontSize: 13, alignItems: "center", background: "var(--surface)", transition: "background 0.1s" }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-hover)")} onMouseLeave={e => (e.currentTarget.style.background = "var(--surface)")}>
              <div style={{ fontWeight: 700, color: "var(--text)" }}>{u.name}</div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>{u.email}</div>
              <div><span style={{ padding: "3px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600, background: u.role === "SUPER_ADMIN" ? "rgba(139,92,246,0.1)" : "rgba(107,114,128,0.1)", color: u.role === "SUPER_ADMIN" ? "#8b5cf6" : "#6b7280" }}>{u.role}</span></div>
              {(Object.keys(PERMISSION_LABELS) as string[]).map(key => (
                <div key={key} style={{ textAlign: "center" }}>
                  <span style={{ color: u[key as keyof User] ? "#10b981" : "#ef4444", fontSize: 16, fontWeight: 700 }}>{u[key as keyof User] ? "✓" : "✗"}</span>
                </div>
              ))}
              <div style={{ textAlign: "center" }}>
                {u.mustChangePassword && <span style={{ padding: "2px 6px", borderRadius: 4, background: "rgba(245,158,11,0.1)", color: "#f59e0b", fontSize: 9, fontWeight: 600 }}>يُغيّر</span>}
              </div>
              <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                <button onClick={() => { setShowEdit(u.id); setEditForm({ name: u.name, email: u.email, role: u.role }); setEditPerms({ canAccessNexup: u.canAccessNexup, canAccessRebound: u.canAccessRebound, canAccessAbomazen: u.canAccessAbomazen, canAccessOfficeFinanceFull: u.canAccessOfficeFinanceFull }); }} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer" }}>✏️</button>
                <button onClick={() => setShowPasswordReset(u.id)} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid rgba(59,130,246,0.3)", background: "rgba(59,130,246,0.05)", color: "#3b82f6", fontSize: 11, cursor: "pointer" }}>🔑</button>
                {confirmDelete === u.id ? (
                  <>
                    <button onClick={() => deleteUser(u.id)} style={{ padding: "4px 8px", borderRadius: 4, border: "none", background: "#ef4444", color: "#fff", fontSize: 10, cursor: "pointer" }}>تأكيد</button>
                    <button onClick={() => setConfirmDelete(null)} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", fontSize: 10, cursor: "pointer", color: "var(--muted)" }}>×</button>
                  </>
                ) : (
                  <button onClick={() => setConfirmDelete(u.id)} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)", color: "#ef4444", fontSize: 11, cursor: "pointer" }}>🗑</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit Modal */}
      {showEdit && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setShowEdit(null)}>
          <div style={{ background: "var(--surface)", borderRadius: 16, padding: 28, width: 480, border: "1px solid var(--border)" }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: "0 0 16px" }}>تعديل المستخدم</h3>
            <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>الاسم</label>
                <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13, outline: "none" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>الإيميل</label>
                <input type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13, outline: "none" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>الدور</label>
                <select value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13, outline: "none" }}>
                  <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                  <option value="ADMIN">ADMIN</option>
                  <option value="EMPLOYEE">EMPLOYEE</option>
                </select>
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 8 }}>الصلاحيات</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(Object.entries(PERMISSION_LABELS) as [string, { label: string; color: string }][]).map(([key, { label, color }]) => (
                  <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, border: `1px solid ${editPerms[key as keyof typeof editPerms] ? color : "var(--border)"}`, background: editPerms[key as keyof typeof editPerms] ? `${color}15` : "transparent", cursor: "pointer" }}>
                    <input type="checkbox" checked={editPerms[key as keyof typeof editPerms]} onChange={e => setEditPerms(p => ({ ...p, [key]: e.target.checked }))} style={{ accentColor: color }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: editPerms[key as keyof typeof editPerms] ? color : "var(--muted)" }}>{label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => updateUser(showEdit)} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "#8b5cf6", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>حفظ</button>
              <button onClick={() => setShowEdit(null)} style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 13, cursor: "pointer" }}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Password Reset Modal */}
      {showPasswordReset && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setShowPasswordReset(null)}>
          <div style={{ background: "var(--surface)", borderRadius: 16, padding: 28, width: 400, border: "1px solid var(--border)" }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: "0 0 16px" }}>🔑 تغيير كلمة المرور</h3>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>كلمة المرور الجديدة *</label>
              <input type="text" value={pwForm.newPassword} onChange={e => setPwForm(f => ({ ...f, newPassword: e.target.value }))} placeholder="6 أحرف على الأقل" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13, outline: "none" }} />
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, cursor: "pointer" }}>
              <input type="checkbox" checked={pwForm.mustChangePassword} onChange={e => setPwForm(f => ({ ...f, mustChangePassword: e.target.checked }))} style={{ accentColor: "#8b5cf6" }} />
              <span style={{ fontSize: 12, color: "var(--muted)" }}>إجبار تغييرها عند أول دخول</span>
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => resetPassword(showPasswordReset)} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "#3b82f6", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>تغيير</button>
              <button onClick={() => setShowPasswordReset(null)} style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 13, cursor: "pointer" }}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
