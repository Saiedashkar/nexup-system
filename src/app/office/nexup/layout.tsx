import type { Metadata } from "next";
import { NexupSidebar } from "@/components/nexup-sidebar";

export const metadata: Metadata = {
  title: "NEXUP — Design Studio",
};

export default function NexupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg)" }}>
      <NexupSidebar />
      <main style={{ flex: 1, overflow: "auto", padding: "28px 32px" }}>
        {children}
      </main>
    </div>
  );
}
