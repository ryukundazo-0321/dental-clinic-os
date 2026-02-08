import Link from "next/link";

export default function Home() {
  const today = new Date();
  const formattedDate = today.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-sky-600 text-white w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold">
              🦷
            </div>
            <h1 className="text-xl font-bold text-gray-900">
              DENTAL CLINIC OS
            </h1>
          </div>
          <div className="text-sm text-gray-500">{formattedDate}</div>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* 本日のサマリー */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 mb-1">本日の予約</p>
            <p className="text-3xl font-bold text-gray-900">--</p>
            <p className="text-xs text-gray-400 mt-1">件</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 mb-1">待合中</p>
            <p className="text-3xl font-bold text-sky-600">--</p>
            <p className="text-xs text-gray-400 mt-1">名</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 mb-1">診察完了</p>
            <p className="text-3xl font-bold text-green-600">--</p>
            <p className="text-xs text-gray-400 mt-1">名</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 mb-1">本日の売上</p>
            <p className="text-3xl font-bold text-gray-900">--</p>
            <p className="text-xs text-gray-400 mt-1">円</p>
          </div>
        </div>

        {/* 業務メニュー */}
        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">
          業務メニュー
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          <Link href="/reservation" className="block">
            <div className="bg-white rounded-xl border border-gray-200 p-5 hover:border-sky-400 hover:shadow-md transition-all group">
              <div className="flex items-center gap-4">
                <div className="bg-blue-50 text-blue-600 w-12 h-12 rounded-xl flex items-center justify-center text-2xl group-hover:bg-blue-100 transition-colors">
                  📅
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">予約管理</h3>
                  <p className="text-sm text-gray-500">予約の確認・新規受付</p>
                </div>
              </div>
            </div>
          </Link>

          <Link href="/checkin" className="block">
            <div className="bg-white rounded-xl border border-gray-200 p-5 hover:border-sky-400 hover:shadow-md transition-all group">
              <div className="flex items-center gap-4">
                <div className="bg-green-50 text-green-600 w-12 h-12 rounded-xl flex items-center justify-center text-2xl group-hover:bg-green-100 transition-colors">
                  📱
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">受付</h3>
                  <p className="text-sm text-gray-500">QRチェックイン・受付番号</p>
                </div>
              </div>
            </div>
          </Link>

          <Link href="/consultation" className="block">
            <div className="bg-white rounded-xl border border-gray-200 p-5 hover:border-sky-400 hover:shadow-md transition-all group">
              <div className="flex items-center gap-4">
                <div className="bg-orange-50 text-orange-600 w-12 h-12 rounded-xl flex items-center justify-center text-2xl group-hover:bg-orange-100 transition-colors">
                  🩺
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">診察室</h3>
                  <p className="text-sm text-gray-500">患者リスト・カルテ・記録</p>
                </div>
              </div>
            </div>
          </Link>

          <Link href="/billing" className="block">
            <div className="bg-white rounded-xl border border-gray-200 p-5 hover:border-sky-400 hover:shadow-md transition-all group">
              <div className="flex items-center gap-4">
                <div className="bg-purple-50 text-purple-600 w-12 h-12 rounded-xl flex items-center justify-center text-2xl group-hover:bg-purple-100 transition-colors">
                  💰
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">会計</h3>
                  <p className="text-sm text-gray-500">精算・レセプト管理</p>
                </div>
              </div>
            </div>
          </Link>

          <Link href="/patients" className="block">
            <div className="bg-white rounded-xl border border-gray-200 p-5 hover:border-sky-400 hover:shadow-md transition-all group">
              <div className="flex items-center gap-4">
                <div className="bg-sky-50 text-sky-600 w-12 h-12 rounded-xl flex items-center justify-center text-2xl group-hover:bg-sky-100 transition-colors">
                  👤
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">患者管理</h3>
                  <p className="text-sm text-gray-500">患者一覧・検索・情報編集</p>
                </div>
              </div>
            </div>
          </Link>

          <Link href="/monitor" className="block">
            <div className="bg-white rounded-xl border border-gray-200 p-5 hover:border-sky-400 hover:shadow-md transition-all group">
              <div className="flex items-center gap-4">
                <div className="bg-teal-50 text-teal-600 w-12 h-12 rounded-xl flex items-center justify-center text-2xl group-hover:bg-teal-100 transition-colors">
                  🖥️
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">待合モニター</h3>
                  <p className="text-sm text-gray-500">待合室表示用画面</p>
                </div>
              </div>
            </div>
          </Link>
        </div>

        {/* 設定 */}
        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">
          設定
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link href="/settings" className="block">
            <div className="bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300 hover:shadow-sm transition-all">
              <div className="flex items-center gap-3">
                <span className="text-gray-400 text-lg">⚙️</span>
                <div>
                  <h3 className="font-bold text-gray-700 text-sm">クリニック設定</h3>
                  <p className="text-xs text-gray-400">基本情報・診察室・スタッフ</p>
                </div>
              </div>
            </div>
          </Link>
          <Link href="/settings/fee-master" className="block">
            <div className="bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300 hover:shadow-sm transition-all">
              <div className="flex items-center gap-3">
                <span className="text-gray-400 text-lg">📋</span>
                <div>
                  <h3 className="font-bold text-gray-700 text-sm">点数マスター</h3>
                  <p className="text-xs text-gray-400">診療報酬点数の管理</p>
                </div>
              </div>
            </div>
          </Link>
          <Link href="/settings/questionnaire" className="block">
            <div className="bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300 hover:shadow-sm transition-all">
              <div className="flex items-center gap-3">
                <span className="text-gray-400 text-lg">📝</span>
                <div>
                  <h3 className="font-bold text-gray-700 text-sm">問診設定</h3>
                  <p className="text-xs text-gray-400">WEB問診フォームの編集</p>
                </div>
              </div>
            </div>
          </Link>
        </div>
      </main>
    </div>
  );
}
