import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Vercel Cronから呼ばれる or 手動呼び出し
// 翌日の予約を抽出してリマインド対象リストを生成
export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: "Supabase credentials not set" }, { status: 500 });
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 翌日の日付
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];

    // 翌日の予約を取得（キャンセル除く）
    const { data: appointments, error } = await supabase
      .from("appointments")
      .select("id, scheduled_at, duration_min, status, patients(id, name_kanji, phone, email)")
      .gte("scheduled_at", `${tomorrowStr}T00:00:00`)
      .lt("scheduled_at", `${tomorrowStr}T23:59:59`)
      .neq("status", "cancelled")
      .order("scheduled_at");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const reminders = (appointments || []).map((apt: Record<string, unknown>) => {
      const p = apt.patients as Record<string, string> | null;
      const time = (apt.scheduled_at as string)?.match(/(\d{2}:\d{2})/)?.[1] || "";
      return {
        appointment_id: apt.id,
        patient_name: p?.name_kanji || "不明",
        phone: p?.phone || null,
        email: p?.email || null,
        time,
        status: apt.status,
        // リマインドメッセージテンプレート
        message: `【予約リマインド】${p?.name_kanji || ""}様\n明日 ${tomorrowStr.replace(/-/g, "/")} ${time} にご予約をいただいております。\nご来院をお待ちしております。`,
      };
    });

    // 送信方法（電話/メール/LINE）に応じた分類
    const withPhone = reminders.filter(r => r.phone);
    const withEmail = reminders.filter(r => r.email);
    const noContact = reminders.filter(r => !r.phone && !r.email);

    return NextResponse.json({
      success: true,
      date: tomorrowStr,
      total: reminders.length,
      reminders,
      summary: {
        with_phone: withPhone.length,
        with_email: withEmail.length,
        no_contact: noContact.length,
      },
      // 将来的にここでメール送信やSMS送信を行う
      note: "現在はリマインドリスト生成のみ。メール/SMS送信は外部サービス連携後に有効化。",
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

// 手動でリマインド実行（将来はメール送信）
export async function POST(request: NextRequest) {
  try {
    // GETと同じリスト生成 + 送信済みフラグ更新
    const getRes = await GET(request);
    const data = await getRes.json();

    if (!data.success) {
      return NextResponse.json(data, { status: 500 });
    }

    // TODO: ここでメール送信API（SendGrid, SES等）を呼ぶ
    // 現在は送信済みマークのみ
    return NextResponse.json({
      ...data,
      sent: false,
      message: `${data.total}件のリマインド対象があります。メール送信サービスを設定すると自動送信が可能になります。`,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
