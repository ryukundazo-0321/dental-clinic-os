"use client";

import { AuthProvider } from "@/lib/auth-context";
import { AuthGuard } from "@/lib/auth-guard";

export function AuthWrapper({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AuthGuard>{children}</AuthGuard>
    </AuthProvider>
  );
}
