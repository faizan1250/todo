import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Todo Studio — Workspace",
  description:
    "High-performance task orchestration interface paired with ElysiaJS backend",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#051A4D" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-white text-[#0B1220] selection:bg-[#FD91CC]/30 selection:text-[#051A4D] dark:bg-[#051A4D] dark:text-[#F8FAFC] dark:selection:bg-[#FD91CC]/30 dark:selection:text-[#FD91CC]">
        {children}
      </body>
    </html>
  );
}
