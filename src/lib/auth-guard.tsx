"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

// 認証不要のページ（患者向け）
const PUBLIC_PATHS = [
  "/login",
  "/reservation/book",
  "/questionnaire",
  "/checkin/self",
  "/monitor",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user && !isPublicPath(pathname)) {
      router.replace("/login");
    }
    if (user && pathname === "/login") {
      router.replace("/");
    }
  }, [user, loading, pathname, router]);

  // ローディング中
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="bg-sky-600 text-white w-12 h-12 rounded-xl flex items-center justify-center text-xl mx-auto mb-3 animate-pulse">🦷</div>
          <p className="text-sm text-gray-400">読み込み中...</p>
        </div>
      </div>
    );
  }

  // 未ログインで保護ページ → 何も表示しない（リダイレクト中）
  if (!user && !isPublicPath(pathname)) {
    return null;
  }

  return <>{children}</>;
}
