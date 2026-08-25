import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nexup | النظام الإداري",
  description: "نظام Nexup لإدارة العملاء والحسابات",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        {/* Prevent white flash: set dark theme before any CSS paints */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var saved = localStorage.getItem('nexup-theme');
                var theme = saved || 'dark';
                document.documentElement.setAttribute('data-theme', theme);
              })();
            `,
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
