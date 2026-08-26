import type { Metadata } from "next";
import { ReboundSidebar } from "@/components/rebound-sidebar";

export const metadata: Metadata = {
  title: "REBOUND — Marketing",
};

export default function ReboundLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg)" }}>
      <ReboundSidebar />
      <main style={{ flex: 1, overflow: "auto", padding: "28px 32px" }}>
        {children}
      </main>
    </div>
  );
}
