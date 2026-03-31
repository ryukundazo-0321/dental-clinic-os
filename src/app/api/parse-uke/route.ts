import { NextRequest, NextResponse } from "next/server";
import { parseUKEBuffer } from "@/lib/uke-parser";

// ============================================================
// POST /api/parse-uke
// uke-parser.ts の薄いラッパー
// デバッグ・単体テスト・将来の拡張用に残す
// INPUT : multipart/form-data { file: UKEファイル（Shift-JIS） }
// OUTPUT: { success: true, data: ParsedUKE }
// ============================================================

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "UKEファイルが見つかりません。multipart/form-dataの'file'フィールドで送信してください。" },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const data = parseUKEBuffer(buffer);

    return NextResponse.json({ success: true, data });

  } catch (e) {
    console.error("[parse-uke] エラー:", e);
    return NextResponse.json(
      { error: `UKEファイルの解析に失敗しました: ${String(e)}` },
      { status: 500 }
    );
  }
}
