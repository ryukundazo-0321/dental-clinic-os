import type { Metadata } from "next";
import "./globals.css";
import { AuthWrapper } from "@/lib/auth-wrapper";

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
      <body>
        <AuthWrapper>{children}</AuthWrapper>
      </body>
    </html>
  );
}
