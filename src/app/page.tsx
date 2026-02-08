import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              🦷 DENTAL CLINIC OS
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              AIありき設計の歯科経営OS
            </p>
          </div>
          <div className="text-sm text-gray-400">v0.1.0</div>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* ステータスバナー */}
        <div className="bg-dental-600 text-white rounded-xl p-6 mb-8">
          <h2 className="text-xl font-bold">Phase 0 : 開発基盤構築</h2>
          <p className="mt-2 text-dental-100">
            データベース構築完了 → Next.jsプロジェクト構築完了 → 機能開発へ
          </p>
        </div>

        {/* 業務フロー4フェーズ */}
        <h3 className="text-lg font-bold text-gray-800 mb-4">
          業務フロー（4フェーズ）
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* フェーズ1：予約〜問診 */}
          <Link href="/reservation" className="block">
            <div className="bg-white rounded-xl border border-gray-200 p-6 hover:border-dental-400 hover:shadow-md transition-all">
              <div className="flex items-center gap-3 mb-3">
                <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-1 rounded">
                  Phase 1
                </span>
                <span className="text-sm text-gray-400">来院前</span>
              </div>
              <h4 className="text-lg font-bold text-gray-900">📅 予約〜問診</h4>
              <p className="text-sm text-gray-500 mt-2">
                AI予約システム → カルテ自動作成 → WEB問診 → SOAP-S自動反映
              </p>
              <div className="mt-3 text-xs text-gray-400">
                予約インターフェース / WEB問診 / カルテ自動生成
              </div>
            </div>
          </Link>

          {/* フェーズ2：受付〜案内 */}
          <Link href="/checkin" className="block">
            <div className="bg-white rounded-xl border border-gray-200 p-6 hover:border-dental-400 hover:shadow-md transition-all">
              <div className="flex items-center gap-3 mb-3">
                <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-1 rounded">
                  Phase 2
                </span>
                <span className="text-sm text-gray-400">来院時</span>
              </div>
              <h4 className="text-lg font-bold text-gray-900">
                📱 受付〜案内
              </h4>
              <p className="text-sm text-gray-500 mt-2">
                QRチェックイン → 受付番号発行 → 待合モニター → 呼び出し
              </p>
              <div className="mt-3 text-xs text-gray-400">
                QRチェックイン / 待合モニター / 呼び出しシステム
              </div>
            </div>
          </Link>

          {/* フェーズ3：診察・処置 */}
          <Link href="/consultation" className="block">
            <div className="bg-white rounded-xl border border-gray-200 p-6 hover:border-dental-400 hover:shadow-md transition-all">
              <div className="flex items-center gap-3 mb-3">
                <span className="bg-orange-100 text-orange-700 text-xs font-bold px-2 py-1 rounded">
                  Phase 3
                </span>
                <span className="text-sm text-gray-400">診療中</span>
              </div>
              <h4 className="text-lg font-bold text-gray-900">
                🩺 診察・処置
              </h4>
              <p className="text-sm text-gray-500 mt-2">
                音声AI分析 → SOAP自動入力 → 歯式自動表記 → 確定ボタン
              </p>
              <div className="mt-3 text-xs text-gray-400">
                音声AI / SOAP自動入力 / AI算定エンジン
              </div>
            </div>
          </Link>

          {/* フェーズ4：会計・精算 */}
          <Link href="/billing" className="block">
            <div className="bg-white rounded-xl border border-gray-200 p-6 hover:border-dental-400 hover:shadow-md transition-all">
              <div className="flex items-center gap-3 mb-3">
                <span className="bg-purple-100 text-purple-700 text-xs font-bold px-2 py-1 rounded">
                  Phase 4
                </span>
                <span className="text-sm text-gray-400">診療後</span>
              </div>
              <h4 className="text-lg font-bold text-gray-900">
                💰 会計・精算
              </h4>
              <p className="text-sm text-gray-500 mt-2">
                レセコン自動算定 → 会計準備完了 → 受付通知 → 精算
              </p>
              <div className="mt-3 text-xs text-gray-400">
                自動算定 / 会計自動化 / 保険請求データ生成
              </div>
            </div>
          </Link>
        </div>

        {/* 管理メニュー */}
        <h3 className="text-lg font-bold text-gray-800 mt-8 mb-4">管理</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link href="/patients" className="block">
            <div className="bg-white rounded-xl border border-gray-200 p-4 hover:border-dental-400 hover:shadow-md transition-all">
              <h4 className="font-bold text-gray-900">👤 患者管理</h4>
              <p className="text-sm text-gray-500 mt-1">患者一覧・検索・情報編集</p>
            </div>
          </Link>
          <Link href="/monitor" className="block">
            <div className="bg-white rounded-xl border border-gray-200 p-4 hover:border-dental-400 hover:shadow-md transition-all">
              <h4 className="font-bold text-gray-900">🖥️ 待合モニター</h4>
              <p className="text-sm text-gray-500 mt-1">
                受付番号・呼び出し表示
              </p>
            </div>
          </Link>
          <Link href="/settings" className="block">
            <div className="bg-white rounded-xl border border-gray-200 p-4 hover:border-dental-400 hover:shadow-md transition-all">
              <h4 className="font-bold text-gray-900">⚙️ 設定</h4>
              <p className="text-sm text-gray-500 mt-1">
                クリニック情報・スタッフ管理
              </p>
            </div>
          </Link>
        </div>
      </main>

      {/* フッター */}
      <footer className="border-t border-gray-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 py-6 text-center text-sm text-gray-400">
          DENTAL CLINIC OS v0.1.0 | AIありき設計の歯科経営OS
        </div>
      </footer>
    </div>
  );
}
