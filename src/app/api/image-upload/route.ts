import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const patientId = formData.get("patient_id") as string;
    const recordId = formData.get("record_id") as string;
    const imageType = (formData.get("image_type") as string) || "panorama";

    if (!file) {
      return NextResponse.json(
        { success: false, error: "ファイルがありません" },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { success: false, error: "Supabase設定がありません" },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // ファイル名を生成
    const ext = file.name.split(".").pop() || "jpg";
    const timestamp = Date.now();
    const storagePath =
      `${patientId}/${timestamp}_${imageType}.${ext}`;

    // Supabase Storageにアップロード
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    const { data: uploadData, error: uploadError } = await supabase
      .storage
      .from("patient-images")
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      return NextResponse.json(
        {
          success: false,
          error: `アップロード失敗: ${uploadError.message}`,
        },
        { status: 500 }
      );
    }

    // 公開URLを取得
    const { data: urlData } = supabase
      .storage
      .from("patient-images")
      .getPublicUrl(storagePath);

    // DBに記録
    const { data: imageRecord, error: dbError } = await supabase
      .from("patient_images")
      .insert({
        patient_id: patientId,
        record_id: recordId || null,
        image_type: imageType,
        storage_path: storagePath,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
      })
      .select()
      .single();

    if (dbError) {
      console.error("DB insert error:", dbError);
    }

    // Base64も返す（Vision API用）
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    return NextResponse.json({
      success: true,
      image: {
        id: imageRecord?.id,
        storage_path: storagePath,
        public_url: urlData?.publicUrl,
        base64: base64,
        file_name: file.name,
        file_size: file.size,
      },
    });
  } catch (e) {
    console.error("image-upload error:", e);
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
