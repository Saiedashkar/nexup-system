import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Nexup | النظام الإداري", description: "نظام Nexup لإدارة العملاء والحسابات" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl"><body>{children}</body></html>;
}
