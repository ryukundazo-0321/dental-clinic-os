import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DENTAL CLINIC OS | 歯科経営OS",
  description: "AIありき設計の歯科経営OS - すべてを一元管理し、人の介在を最小限に",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
