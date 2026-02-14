"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error: err } = await signIn(email, password);
    if (err) {
      setError(err === "Invalid login credentials" ? "メールアドレスまたはパスワードが正しくありません" : err);
      setLoading(false);
    } else {
      router.push("/");
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="bg-sky-600 text-white w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4">🦷</div>
          <h1 className="text-2xl font-bold text-gray-900">DENTAL CLINIC OS</h1>
          <p className="text-sm text-gray-400 mt-1">スタッフログイン</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}
          <div>
            <label className="text-xs text-gray-500 font-bold block mb-1">メールアドレス</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              placeholder="example@clinic.jp"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400" />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-bold block mb-1">パスワード</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              placeholder="••••••••"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full bg-sky-600 text-white py-3 rounded-xl font-bold text-sm hover:bg-sky-700 disabled:opacity-50 transition-colors">
            {loading ? "ログイン中..." : "ログイン"}
          </button>
        </form>

        <p className="text-center text-xs text-gray-300 mt-6">初回ログインのアカウントはSupabase管理画面で作成してください</p>
      </div>
    </div>
  );
}
