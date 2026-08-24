"use client";

export default function NexupSettingsPage() {
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", margin: 0 }}>Settings</h1>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>NEXUP business configuration</p>
      </div>
      <div style={{ textAlign: "center", padding: 60, background: "var(--surface)", borderRadius: 14, border: "1px solid var(--border)" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>⚙️</div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>Coming Soon</h2>
        <p style={{ color: "var(--muted)", fontSize: 14 }}>Business settings, services, and user management will be available here</p>
      </div>
    </div>
  );
}
