import { NextRequest, NextResponse } from "next/server";

// ★ OpenAI APIキーをフロントエンドに渡すエンドポイント
// Whisperの音声ファイルをVercel経由で送ると4.5MB制限に引っかかるため、
// フロントエンドから直接OpenAI APIを呼ぶ必要がある
export async function GET(request: NextRequest) {
  // 基本的なオリジンチェック（同一オリジンからのリクエストのみ許可）
  const origin = request.headers.get("origin") || "";
  const referer = request.headers.get("referer") || "";
  const host = request.headers.get("host") || "";

  // リクエストがこのサイトからのものか確認
  if (origin && !origin.includes(host.split(":")[0])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "APIキーが設定されていません" }, { status: 500 });
  }

  return NextResponse.json({ key: apiKey });
}
