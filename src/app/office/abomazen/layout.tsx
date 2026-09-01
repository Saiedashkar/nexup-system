import type { Metadata } from "next";
import { AbomazenSidebar } from "@/components/abomazen-sidebar";

export const metadata: Metadata = {
  title: "ABOMAZEN — تسويق عقاري",
};

export default function AbomazenLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg)" }}>
      <AbomazenSidebar />
      <main style={{ flex: 1, overflow: "auto", padding: "28px 32px" }} className="main-content-mobile-pad">
        {children}
      </main>
    </div>
  );
}
