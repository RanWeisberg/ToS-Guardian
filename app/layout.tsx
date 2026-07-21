/**
 * app/layout.tsx — the root layout wrapping every page.
 *
 * Applies the frozen visual language (DESIGN.md): the warm off-white canvas,
 * near-black text, and the Manrope typeface (loaded via Google Fonts, matching
 * the design handoff). Kept intentionally minimal — chrome (top bar + tab nav)
 * lives in <AppShell>, per-screen styling in each component's CSS module.
 */

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ToS Guardian",
  description:
    "Turn the unread legal fine print of the services you use into personalized, change-aware alerts.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
