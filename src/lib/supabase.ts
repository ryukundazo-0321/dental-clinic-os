import { createClient } from "@supabase/supabase-js";

// Supabaseの接続情報（環境変数から取得）
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Supabaseクライアントを作成（アプリ全体で使い回す）
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
