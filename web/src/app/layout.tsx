import type { Metadata } from "next";
import localFont from "next/font/local";
import { connection } from "next/server";

import "./globals.css";

// Bundle the OFL font files with the application. Both production builds and
// guest visits work without contacting a third-party font service.
const displayFont = localFont({
  src: [
    { path: "./fonts/cormorant-garamond-latin-variable.woff2", weight: "300 700", style: "normal" },
    { path: "./fonts/cormorant-garamond-latin-italic-variable.woff2", weight: "300 700", style: "italic" }
  ],
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
  adjustFontFallback: "Times New Roman",
  variable: "--font-display"
});

const editorialFont = localFont({
  src: [
    { path: "./fonts/lora-latin-variable.woff2", weight: "400 700", style: "normal" },
    { path: "./fonts/lora-latin-italic-variable.woff2", weight: "400 700", style: "italic" }
  ],
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
  adjustFontFallback: "Times New Roman",
  variable: "--font-editorial"
});

const bodyFont = localFont({
  src: "./fonts/dm-sans-latin-variable.woff2",
  weight: "100 1000",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
  variable: "--font-body"
});

// Hindi faces load when Hindi text is present, without a preload on every visit.
const devanagariFont = localFont({
  src: "./fonts/noto-sans-devanagari-variable.woff2",
  weight: "100 900",
  display: "swap",
  preload: false,
  fallback: ["Nirmala UI", "Mangal", "sans-serif"],
  variable: "--font-devanagari"
});

const devanagariDisplayFont = localFont({
  src: "./fonts/eczar-devanagari-variable.woff2",
  weight: "400 800",
  display: "swap",
  preload: false,
  fallback: ["Nirmala UI", "Mangal", "serif"],
  variable: "--font-devanagari-display"
});

const coupleFont = localFont({
  src: "./fonts/great-vibes-latin-regular.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  preload: false,
  fallback: ["Georgia", "serif"],
  variable: "--font-couple"
});

const coupleHindiFont = localFont({
  src: "./fonts/tiro-devanagari-hindi-devanagari-regular.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  preload: false,
  fallback: ["Nirmala UI", "Mangal", "serif"],
  variable: "--font-couple-hi"
});

export const metadata: Metadata = {
  title: "Private Wedding Invitation",
  description: "A private wedding invitation and RSVP.",
  robots: { index: false, follow: false }
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Nonce-based CSP must render HTML for a real request, never from a static shell.
  await connection();

  return (
    <html lang="en" className={`${displayFont.variable} ${editorialFont.variable} ${bodyFont.variable} ${devanagariFont.variable} ${devanagariDisplayFont.variable} ${coupleFont.variable} ${coupleHindiFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
