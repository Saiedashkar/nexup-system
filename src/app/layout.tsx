import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

/* Self-host Inter via next/font — eliminates render-blocking Google Fonts CSS,
   provides automatic font-display:swap, and reduces DNS+TLS overhead. */
const inter = Inter({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Nexup | النظام الإداري",
  description: "نظام Nexup لإدارة العملاء والحسابات",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Nexup",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0f172a",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning className={inter.variable}>
      <head>
        {/* Prevent white flash: set dark theme before any CSS paints */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var saved = localStorage.getItem('nexup-theme');
                var theme = saved || 'dark';
                document.documentElement.setAttribute('data-theme', theme);
              })();`,
          }}
        />

        {/* Favicon */}
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

        {/* Speculation Rules: prefetch likely next navigations on hover */}
        <script
          type="speculationrules"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              prefetch: [
                { source: "document", where: { href_matches: "/office/*" }, eagerness: "moderate" },
              ],
            }),
          }}
        />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
