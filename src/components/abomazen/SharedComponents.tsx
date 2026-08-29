"use client";

import { useEffect, useState, memo, useRef } from "react";

/* ═══════════════════════════════════════════════════
   ANIMATED NUMBER (Optimized with React.memo)
   ═══════════════════════════════════════════════════ */
export const AnimatedNumber = memo(({ value, suffix = "", duration = 1000 }: { value: number; suffix?: string; duration?: number }) => {
  const [displayValue, setDisplayValue] = useState(0);
  
  useEffect(() => {
    let start = 0;
    const end = value;
    const increment = end / (duration / 16);
    const timer = setInterval(() => {
      start += increment;
      if (start >= end) {
        setDisplayValue(end);
        clearInterval(timer);
      } else {
        setDisplayValue(start);
      }
    }, 16);
    return () => clearInterval(timer);
  }, [value, duration]);

  return <>{Math.floor(displayValue).toLocaleString("en-US")}{suffix}</>;
});
AnimatedNumber.displayName = "AnimatedNumber";

/* ═══════════════════════════════════════════════════
   LOADING SKELETON
   ═══════════════════════════════════════════════════ */
export function LoadingSkeleton({ message = "جاري تحميل البيانات..." }: { message?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "70vh", flexDirection: "column", gap: 20 }}>
      <div style={{
        width: 60, height: 60, border: "4px solid var(--border)",
        borderTopColor: "#8b5cf6", borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
      }} />
      <div style={{ color: "var(--muted)", fontSize: 14, fontWeight: 600 }}>{message}</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   EMPTY STATE
   ═══════════════════════════════════════════════════ */
export function EmptyState({ 
  icon = "🏠", 
  title = "لا توجد بيانات", 
  description = "لم يتم العثور على أي سجلات", 
  action,
  actionLabel 
}: { 
  icon?: string; 
  title?: string; 
  description?: string; 
  action?: () => void;
  actionLabel?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "50vh", padding: 40 }}>
      <div style={{
        width: 120, height: 120, borderRadius: "50%",
        background: "linear-gradient(135deg, rgba(139,92,246,0.1), rgba(139,92,246,0.03))",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 56, marginBottom: 24,
      }}>
        {icon}
      </div>
      <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 12, letterSpacing: "-0.02em" }}>
        {title}
      </h2>
      <p style={{ color: "var(--muted)", fontSize: 14, maxWidth: 400, textAlign: "center", lineHeight: 1.6, marginBottom: 28 }}>
        {description}
      </p>
      {action && actionLabel && (
        <button onClick={action} style={{
          padding: "12px 28px", borderRadius: 10,
          background: "linear-gradient(135deg, #8b5cf6, #7c3aed)",
          color: "#fff", fontSize: 14, fontWeight: 600,
          border: "none", cursor: "pointer",
          boxShadow: "0 4px 12px rgba(139,92,246,0.3)",
        }}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   STAT CARD (Optimized with memo)
   ═══════════════════════════════════════════════════ */
export const StatCard = memo(({ 
  label, 
  labelEn, 
  value, 
  icon, 
  color, 
  bg,
  animated = false 
}: { 
  label: string; 
  labelEn?: string;
  value: number | string; 
  icon: string; 
  color: string; 
  bg: string;
  animated?: boolean;
}) => {
  const [hovered, setHovered] = useState(false);

  return (
    <div 
      style={{
        padding: "20px 22px", borderRadius: 14,
        background: "var(--surface)", border: "1px solid var(--border)",
        transition: "all 0.2s", cursor: "pointer",
        transform: hovered ? "translateY(-2px)" : "translateY(0)",
        boxShadow: hovered ? `0 8px 20px ${color}20` : "none",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: bg,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 20,
        }}>
          {icon}
        </div>
        <div>
          <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>{label}</div>
          {labelEn && <div style={{ fontSize: 10, color: "var(--muted)", opacity: 0.7 }}>{labelEn}</div>}
        </div>
      </div>
      <div style={{ fontSize: 32, fontWeight: 800, color, letterSpacing: "-0.02em" }}>
        {animated && typeof value === "number" && hovered ? <AnimatedNumber value={value} /> : value}
      </div>
    </div>
  );
});
StatCard.displayName = "StatCard";

/* ═══════════════════════════════════════════════════
   HERO BALANCE CARD
   ═══════════════════════════════════════════════════ */
export function HeroBalanceCard({ 
  balance, 
  title = "الرصيد المتاح",
  titleEn = "Available Balance",
  description = "صافي مبلغ الصفقات بعد خصم المصروفات والتحويلات",
  icon = "💰"
}: { 
  balance: number; 
  title?: string;
  titleEn?: string;
  description?: string;
  icon?: string;
}) {
  return (
    <div style={{
      padding: "32px 36px", borderRadius: 18, marginBottom: 28,
      background: "linear-gradient(135deg, rgba(139,92,246,0.08) 0%, rgba(139,92,246,0.02) 100%)",
      border: "1px solid rgba(139,92,246,0.15)",
      position: "relative", overflow: "hidden",
      boxShadow: "0 4px 20px rgba(139,92,246,0.12)",
    }}>
      {/* Decorative circles */}
      <div style={{ position: "absolute", top: -40, right: -40, width: 140, height: 140, borderRadius: "50%", background: "rgba(139,92,246,0.06)" }} />
      <div style={{ position: "absolute", bottom: -30, left: -30, width: 100, height: 100, borderRadius: "50%", background: "rgba(139,92,246,0.04)" }} />
      
      <div style={{ position: "relative", zIndex: 1, textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: "rgba(139,92,246,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>{icon}</div>
          <div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 600, textAlign: "left" }}>{title}</div>
            <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "left" }}>{titleEn}</div>
          </div>
        </div>
        <div style={{
          fontSize: 52, fontWeight: 900,
          color: balance >= 0 ? "#8b5cf6" : "#ef4444",
          direction: "ltr", lineHeight: 1, letterSpacing: "-0.03em",
          marginBottom: 8,
        }}>
          <AnimatedNumber value={balance} /> <span style={{ fontSize: 20, fontWeight: 600 }}>EGP</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>
          {description}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   SEARCH INPUT (with debounce)
   ═══════════════════════════════════════════════════ */
export function SearchInput({ 
  value, 
  onChange, 
  placeholder = "🔍 بحث...",
  debounceMs = 300 
}: { 
  value: string; 
  onChange: (value: string) => void; 
  placeholder?: string;
  debounceMs?: number;
}) {
  const [localValue, setLocalValue] = useState(value);
  const timeoutRef = useRef<NodeJS.Timeout>(undefined);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = (newValue: string) => {
    setLocalValue(newValue);
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    timeoutRef.current = setTimeout(() => {
      onChange(newValue);
    }, debounceMs);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <div style={{ position: "relative", flex: 1 }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} 
        style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: "var(--muted)", pointerEvents: "none" }}>
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
      <input 
        placeholder={placeholder} 
        value={localValue} 
        onChange={e => handleChange(e.target.value)}
        style={{ 
          width: "100%", 
          padding: "10px 16px 10px 40px", 
          borderRadius: 10, 
          border: "1px solid var(--border)", 
          background: "var(--surface)", 
          color: "var(--text)", 
          fontSize: 14, 
          outline: "none",
          transition: "all 0.2s"
        }} 
        onFocus={e => e.currentTarget.style.borderColor = "#8b5cf6"}
        onBlur={e => e.currentTarget.style.borderColor = "var(--border)"}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   PAGE HEADER
   ═══════════════════════════════════════════════════ */
export function PageHeader({ 
  icon = "🏠", 
  title, 
  subtitle,
  action,
  actionLabel 
}: { 
  icon?: string; 
  title: string; 
  subtitle?: string;
  action?: () => void;
  actionLabel?: string;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{
          width: 52, height: 52, borderRadius: 14,
          background: "linear-gradient(135deg, #8b5cf6, #7c3aed)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 26, boxShadow: "0 4px 16px rgba(139,92,246,0.3)",
        }}>
          {icon}
        </div>
        <div>
          <h1 style={{
            fontSize: 28, fontWeight: 900, color: "var(--text)",
            margin: 0, letterSpacing: "-0.03em",
          }}>
            {title}
          </h1>
          {subtitle && (
            <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0", fontWeight: 500 }}>
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {action && actionLabel && (
        <button onClick={action} style={{
          padding: "12px 24px", borderRadius: 12,
          background: "linear-gradient(135deg, #8b5cf6, #7c3aed)",
          color: "#fff", border: "none", fontSize: 14, fontWeight: 700,
          cursor: "pointer", boxShadow: "0 4px 12px rgba(139,92,246,0.3)",
          transition: "all 0.2s",
          display: "flex", alignItems: "center", gap: 8,
        }}
          onMouseEnter={e => {
            e.currentTarget.style.transform = "translateY(-2px)";
            e.currentTarget.style.boxShadow = "0 8px 20px rgba(139,92,246,0.4)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow = "0 4px 12px rgba(139,92,246,0.3)";
          }}
        >
          <span>+</span> {actionLabel}
        </button>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   PAGINATION (for performance)
   ═══════════════════════════════════════════════════ */
export function Pagination({ 
  currentPage, 
  totalPages, 
  onPageChange 
}: { 
  currentPage: number; 
  totalPages: number; 
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  const pages = [];
  const showEllipsis = totalPages > 7;

  if (showEllipsis) {
    if (currentPage <= 3) {
      for (let i = 1; i <= 5; i++) pages.push(i);
      pages.push(-1); // ellipsis
      pages.push(totalPages);
    } else if (currentPage >= totalPages - 2) {
      pages.push(1);
      pages.push(-1);
      for (let i = totalPages - 4; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      pages.push(-1);
      for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i);
      pages.push(-1);
      pages.push(totalPages);
    }
  } else {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  }

  return (
    <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 20, alignItems: "center" }}>
      <button 
        onClick={() => onPageChange(currentPage - 1)} 
        disabled={currentPage === 1}
        style={{
          padding: "8px 12px", borderRadius: 8,
          border: "1px solid var(--border)",
          background: currentPage === 1 ? "var(--surface)" : "var(--surface-hover)",
          color: currentPage === 1 ? "var(--muted)" : "var(--text)",
          fontSize: 14, fontWeight: 600, cursor: currentPage === 1 ? "not-allowed" : "pointer",
          opacity: currentPage === 1 ? 0.5 : 1,
        }}
      >
        ←
      </button>
      
      {pages.map((page, idx) => (
        page === -1 ? (
          <span key={`ellipsis-${idx}`} style={{ padding: "0 8px", color: "var(--muted)" }}>...</span>
        ) : (
          <button 
            key={page}
            onClick={() => onPageChange(page)} 
            style={{
              padding: "8px 14px", borderRadius: 8,
              border: page === currentPage ? "2px solid #8b5cf6" : "1px solid var(--border)",
              background: page === currentPage ? "rgba(139,92,246,0.12)" : "var(--surface)",
              color: page === currentPage ? "#8b5cf6" : "var(--text)",
              fontSize: 14, fontWeight: page === currentPage ? 700 : 600,
              cursor: "pointer",
              minWidth: 40,
            }}
          >
            {page}
          </button>
        )
      ))}

      <button 
        onClick={() => onPageChange(currentPage + 1)} 
        disabled={currentPage === totalPages}
        style={{
          padding: "8px 12px", borderRadius: 8,
          border: "1px solid var(--border)",
          background: currentPage === totalPages ? "var(--surface)" : "var(--surface-hover)",
          color: currentPage === totalPages ? "var(--muted)" : "var(--text)",
          fontSize: 14, fontWeight: 600, cursor: currentPage === totalPages ? "not-allowed" : "pointer",
          opacity: currentPage === totalPages ? 0.5 : 1,
        }}
      >
        →
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   UTILITY: Format helpers
   ═══════════════════════════════════════════════════ */
export const fmt = (n: number) => n.toLocaleString("en-US");
export const fmtDate = (d: string) => new Date(d).toLocaleDateString("ar-EG", { day: "2-digit", month: "short", year: "numeric" });
