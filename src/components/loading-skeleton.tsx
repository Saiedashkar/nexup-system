"use client";

import React from "react";

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Basic skeleton element with pulse animation
 */
export function Skeleton({
  width,
  height = 20,
  borderRadius = 8,
  className = "",
  style = {},
}: SkeletonProps) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{
        width,
        height,
        borderRadius,
        background: "linear-gradient(90deg, var(--surface-hover) 25%, var(--border) 50%, var(--surface-hover) 75%)",
        backgroundSize: "200% 100%",
        animation: "pulse 1.5s ease-in-out infinite",
        ...style,
      }}
    />
  );
}

/**
 * Card skeleton for stat cards
 */
export function StatCardSkeleton() {
  return (
    <div
      style={{
        padding: 20,
        borderRadius: 16,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        boxShadow: "var(--card-shadow)",
      }}
    >
      <Skeleton width={40} height={40} borderRadius={10} />
      <div style={{ marginTop: 12 }}>
        <Skeleton width="60%" height={24} />
        <div style={{ marginTop: 8 }}>
          <Skeleton width="40%" height={14} />
        </div>
      </div>
    </div>
  );
}

/**
 * Table row skeleton
 */
export function TableRowSkeleton({ columns = 5 }: { columns?: number }) {
  return (
    <tr>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} style={{ padding: "14px 16px" }}>
          <Skeleton width="80%" height={16} />
        </td>
      ))}
    </tr>
  );
}

/**
 * Table skeleton with header and rows
 */
export function TableSkeleton({
  rows = 5,
  columns = 5,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div
      style={{
        borderRadius: 16,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        overflow: "hidden",
      }}
    >
      {/* Header skeleton */}
      <div
        style={{
          padding: "12px 16px",
          background: "var(--surface-hover)",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          gap: 24,
        }}
      >
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} width={80 + Math.random() * 40} height={14} />
        ))}
      </div>
      
      {/* Row skeletons */}
      <div style={{ padding: "0 16px" }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            style={{
              padding: "14px 0",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              gap: 24,
            }}
          >
            {Array.from({ length: columns }).map((_, j) => (
              <Skeleton
                key={j}
                width={60 + Math.random() * 60}
                height={16}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Dashboard skeleton with cards and table
 */
export function DashboardSkeleton() {
  return (
    <div style={{ padding: 32 }}>
      {/* Header skeleton */}
      <div style={{ marginBottom: 36 }}>
        <Skeleton width={200} height={32} />
        <div style={{ marginTop: 8 }}>
          <Skeleton width={300} height={14} />
        </div>
      </div>

      {/* Stat cards skeleton */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 16,
          marginBottom: 28,
        }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>

      {/* Table skeleton */}
      <TableSkeleton rows={8} columns={6} />
    </div>
  );
}

/**
 * Sidebar skeleton
 */
export function SidebarSkeleton() {
  return (
    <div
      style={{
        width: 260,
        minHeight: "100vh",
        background: "var(--sidebar-bg)",
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      {/* Brand skeleton */}
      <div>
        <Skeleton width={120} height={24} />
        <div style={{ marginTop: 8 }}>
          <Skeleton width={80} height={12} />
        </div>
      </div>

      {/* Nav items skeleton */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} width="100%" height={40} borderRadius={10} />
        ))}
      </div>
    </div>
  );
}
