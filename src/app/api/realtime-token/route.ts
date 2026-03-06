import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ==============================
// レートリミット（メモリ内）
// 本番はRedisやUpstashを推奨
// ==============================
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 3;       // 1分あたり最大3回
const RATE_LIMIT_WINDOW = 60_000; // 1分

function checkRateLimit(key: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0 };
  }

  entry.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count };
}

// ==============================
// メインハンドラー
// ==============================
export async function POST(req: NextRequest) {
  // ① OpenAI APIキー確認
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("[realtime-token] OPENAI_API_KEY not set");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  // ② IPアドレス取得（ログ・レートリミット用）
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  // ③ レートリミットチェック（IPベース）
  const rateCheck = checkRateLimit(`ip:${ip}`);
  if (!rateCheck.allowed) {
    console.warn(`[realtime-token] Rate limit exceeded — IP: ${ip}`);
    return NextResponse.json(
      { error: "Too many requests. Please wait 1 minute." },
      {
        status: 429,
        headers: { "Retry-After": "60" },
      }
    );
  }

  // ④ Supabase認証チェック（ログイン必須）
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    console.warn(`[realtime-token] Missing auth header — IP: ${ip}`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userToken = authHeader.replace("Bearer ", "");

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser(userToken);

  if (authError || !user) {
    console.warn(`[realtime-token] Invalid session — IP: ${ip}`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ⑤ レートリミット（ユーザーIDベースでも二重チェック）
  const userRateCheck = checkRateLimit(`user:${user.id}`);
  if (!userRateCheck.allowed) {
    console.warn(`[realtime-token] User rate limit exceeded — user: ${user.id}`);
    return NextResponse.json(
      { error: "Too many requests. Please wait 1 minute." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  // ⑥ アクセスログ
  console.info(
    `[realtime-token] Token issued — user: ${user.id} | IP: ${ip} | remaining: ${userRateCheck.remaining}`
  );

  // ⑦ OpenAI Ephemeral Token発行（有効期限60秒）
  try {
    const res = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2024-12-17",
        voice: "alloy",
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[realtime-token] OpenAI error: ${err}`);
      return NextResponse.json({ error: "OpenAI API error" }, { status: 502 });
    }

    const data = await res.json();

    // APIキー本体は絶対に返さない — ephemeral tokenのみ返す
    return NextResponse.json(
      { client_secret: data.client_secret.value },
      {
        headers: {
          // キャッシュ禁止（tokenが再利用されないように）
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "X-RateLimit-Remaining": String(userRateCheck.remaining),
        },
      }
    );
  } catch (e) {
    console.error("[realtime-token] Unexpected error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET/PUT等は全て拒否
export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
