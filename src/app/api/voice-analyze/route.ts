import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File;
    const existingSoapS = formData.get("existing_soap_s") as string || "";

    if (!audioFile) {
      return NextResponse.json({ error: "音声ファイルがありません" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OpenAI APIキーが設定されていません。Vercelの環境変数を確認してください。" }, { status: 500 });
    }

    // ===== Step 1: Whisper API で音声→テキスト変換 =====
    // 歯科専門用語を網羅的にプロンプトに含めることで認識精度を大幅に向上
    let transcript = "";
    try {
      const whisperFormData = new FormData();
      whisperFormData.append("file", audioFile, "recording.webm");
      whisperFormData.append("model", "whisper-1");
      whisperFormData.append("language", "ja");
      whisperFormData.append("prompt", [
        // 基本的な診療会話の文脈を提示
        "歯科診療所での歯科医師と患者の診察会話の書き起こし。",

        // === 歯番号（FDI表記）===
        "右上1番 右上2番 右上3番 右上4番 右上5番 右上6番 右上7番 右上8番",
        "左上1番 左上2番 左上3番 左上4番 左上5番 左上6番 左上7番 左上8番",
        "右下1番 右下2番 右下3番 右下4番 右下5番 右下6番 右下7番 右下8番",
        "左下1番 左下2番 左下3番 左下4番 左下5番 左下6番 左下7番 左下8番",

        // === う蝕・歯の状態 ===
        "う蝕 C0 CO C1 C2 C3 C4 二次カリエス 二次う蝕 残根 歯質軟化",
        "生活歯 失活歯 健全歯 動揺歯 動揺度 弄舌癖",

        // === 診査・検査 ===
        "打診 打診痛 冷水痛 温熱痛 自発痛 咬合痛 咬合時痛",
        "歯髄診 歯髄電気診 EPT 冷温診 歯周ポケット プロービング BOP",
        "根尖透過像 歯根膜腔の拡大 歯槽骨吸収 パノラマ デンタル X線",
        "PCR 口腔衛生指数 染め出し TBI 歯周組織検査",

        // === 歯冠修復・補綴（超重要）===
        "FMC 全部金属冠 エフエムシー 金属冠 メタルクラウン",
        "CAD/CAM冠 キャドキャムカン 硬質レジンジャケット冠",
        "前装冠 メタルボンド 陶材焼付鋳造冠 MB ジルコニアクラウン",
        "インレー アンレー メタルインレー レジンインレー",
        "CR充填 コンポジットレジン充填 光重合 レジン修復",
        "ブリッジ Br 支台歯 ポンティック ダミー",
        "クラウン 被せ物 かぶせ物 銀歯 補綴物",
        "TEK テック 仮歯 プロビジョナルレストレーション テンポラリークラウン",

        // === 印象・咬合 ===
        "印象採得 精密印象 連合印象 概形印象 個人トレー 対合印象",
        "咬合採得 バイト ワックスバイト 咬合紙 フェイスボウ",
        "型取り 型どり シリコン印象 アルジネート印象",
        "装着 セット 仮着 合着 接着 セメント",

        // === 義歯 ===
        "義歯 入れ歯 デンチャー 部分床義歯 パーシャルデンチャー",
        "総義歯 全部床義歯 フルデンチャー",
        "クラスプ レスト コネクター 義歯床 人工歯",
        "義歯調整 義歯修理 リベース リライン 増歯",

        // === 歯内療法 ===
        "抜髄 ばつずい 麻酔抜髄 根管治療 根治 感染根管治療 感根治",
        "根管形成 根管拡大 根管洗浄 根管貼薬 根管充填 根充",
        "ファイル リーマー ガッタパーチャ GP ラテラル バーチカル",
        "根管長測定 EMR 電気的根管長測定",
        "支台築造 コア メタルコア レジンコア ファイバーポスト",

        // === 歯周治療 ===
        "歯周病 歯周炎 歯肉炎 P G 辺縁性歯周炎",
        "スケーリング SC SRP ルートプレーニング 歯石除去",
        "歯周外科 フラップ手術 フラップオペ FOP 再生療法",
        "PMTC 機械的歯面清掃 歯面研磨",
        "P1 P2 P3 P4 歯周基本治療",

        // === 外科 ===
        "抜歯 普通抜歯 難抜歯 埋伏歯抜歯 水平埋伏智歯",
        "親知らず 智歯 智歯周囲炎 ペリコ Perico",
        "切開 排膿 消炎 縫合 抜糸",
        "歯根端切除術 歯根嚢胞摘出術 歯槽骨整形術",

        // === 麻酔 ===
        "浸潤麻酔 浸麻 しんじゅんますい 伝達麻酔 下顎孔伝達麻酔",
        "表面麻酔 キシロカイン リドカイン アーティカイン",

        // === 形成 ===
        "歯冠形成 形成 支台歯形成 窩洞形成 インレー形成",
        "マージン フィニッシュライン ショルダー シャンファー テーパー",

        // === 投薬 ===
        "処方 投薬 頓服 内服",
        "ロキソニン ロキソプロフェン カロナール アセトアミノフェン ボルタレン",
        "フロモックス セフカペン サワシリン アモキシシリン クラリス",
        "ムコスタ レバミピド テプレノン セルベックス",
        "アズノール デキサルチン ケナログ",

        // === 補綴判断用キーワード ===
        "失PZ 脱離 だつり PZ脱離 インレー脱離 クラウン脱離",
        "破折 チッピング 二次カリエス 不適合 マージン不適合",
        "補綴時診断 補管 歯冠修復 欠損補綴",
        "新製 再製 再装着 修理",

        // === 頻出する診療フレーズ ===
        "次回セット予定 次回装着 型取りします 噛んでください",
        "痛みはありますか しみますか 腫れていますか",
        "お口開けてください うがいしてください お疲れ様でした",
      ].join(" "));

      const whisperResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: whisperFormData,
      });

      if (!whisperResponse.ok) {
        const errText = await whisperResponse.text();
        console.error("Whisper error:", errText);
        return NextResponse.json({ 
          error: `音声認識エラー: ${whisperResponse.status}。APIキーとクレジット残高を確認してください。`,
          detail: errText
        }, { status: 500 });
      }

      const whisperResult = await whisperResponse.json();
      transcript = whisperResult.text || "";
    } catch (whisperErr) {
      console.error("Whisper exception:", whisperErr);
      return NextResponse.json({ error: "音声認識処理でエラーが発生しました" }, { status: 500 });
    }

    if (!transcript || transcript.trim().length < 5) {
      return NextResponse.json({ 
        error: "音声が短すぎるか認識できませんでした。もう少し長く、はっきり話してみてください。",
        transcript: transcript || "(認識テキストなし)"
      }, { status: 400 });
    }

    // ===== Step 2: GPT-4o でテキスト→SOAP+歯式変換 =====
    let soapData = null;
    try {
      const systemPrompt = `あなたは日本の歯科診療所で使用される電子カルテのAIアシスタントです。
歯科医師の診察会話を正確にSOAPノートに変換する専門家です。

## あなたの役割
- 歯科医師と患者の会話テキストから、正確なSOAPノートを生成する
- 歯科専門用語を正しく理解し、適切な診断名・処置名を出力する
- 歯番号をFDI表記（2桁数字）で正確に記録する

## 歯番号のルール（FDI表記）
右上: 18,17,16,15,14,13,12,11
左上: 21,22,23,24,25,26,27,28
右下: 48,47,46,45,44,43,42,41
左下: 31,32,33,34,35,36,37,38

「右下5番」→ 45、「左上6番」→ 26、「右上1番」→ 11
「右下の奥歯」→ 文脈から46,47,48のいずれか判断
「前歯」→ 文脈から11-13,21-23,31-33,41-43のいずれか判断

## 処置の正しい分類（重要）
以下を正確に区別すること：

【歯冠修復・補綴】
- FMC（全部金属冠）: 金属冠、エフエムシー、銀歯をかぶせる → procedures: ["FMC"]
- CAD/CAM冠: キャドキャム冠 → procedures: ["CAD/CAM冠"]
- 前装冠: 前装MC → procedures: ["前装冠"]
- インレー: 金属の詰め物 → procedures: ["インレー"]
- CR充填: コンポジットレジン充填、光重合、白い詰め物 → procedures: ["CR充填"]
- ブリッジ: Br → procedures: ["ブリッジ"]

【FMCとCR充填の区別（超重要）】
- FMC: 「形成」+「印象（型取り）」+「次回セット」= 2回以上の来院が必要 → FMC
- CR充填: 「充填」「光照射」「光重合」= 1回で完了する → CR充填
- 「金属冠の形成」「FMC形成」「クラウン形成」→ 必ずFMC
- 「連合印象」「精密印象」→ 補綴物の型取り → FMCやインレーなど間接法
- 「CR充填」「レジン修復」「光重合」→ CR充填（直接法）

【歯内療法】
- 抜髄: 麻酔抜髄、生活歯髄切断 → procedures: ["抜髄"]
- 感根治: 感染根管治療 → procedures: ["感根治"]
- 根充: 根管充填 → procedures: ["根充"]

【歯周治療】
- SC: スケーリング → procedures: ["SC"]
- SRP: ルートプレーニング → procedures: ["SRP"]

【外科】
- 抜歯: 普通抜歯 → procedures: ["普通抜歯"]
- 難抜: 難抜歯 → procedures: ["難抜歯"]

【その他】
- 装着: セット → procedures: ["装着"]
- TEK: テック、仮歯 → procedures: ["TEK"]
- 印象: 型取り → procedures: ["印象"]
- 浸潤麻酔: 浸麻 → procedures: ["浸麻"]

## 診断名（傷病名）のルール
- 会話中に明示的に言及された診断のみを記録する
- 推測で診断名を追加しない
- 「C2」と言ったらC2のみ。「歯周炎」と言及していないのに歯周炎を追加しない
- 複数の診断が言及された場合は全て記録する

## SOAP記載のルール
S（主観）: 患者の主訴・訴え。「痛い」「しみる」「取れた」等の患者の言葉
O（客観）: 医師の所見。検査結果、口腔内状態。略語OK（例: 「#45 失PZ脱離 二次カリエス(+) 打診(-) 冷水痛(+)」）
A（評価）: 診断名。歯番号+病名（例: 「#45 C2」「#46 Pul」）
P（計画）: 本日の処置 + 処方薬 + 次回予定。処方があれば必ず記載（例: 「FMC形成・連合印象・浸麻 処方:ロキソニン60mg・ムコスタ100mg 3日分 次回FMCセット予定」）
  ※「処方」「ロキソニン」「ムコスタ」「フロモックス」等の薬剤名が会話に含まれる場合、P欄に必ず「処方:薬名 日数」を記載すること。省略禁止。

## 出力形式
必ず以下のJSON形式のみを出力。説明文やマークダウンは絶対に含めないこと。`;

      const userPrompt = `以下の歯科診察の会話テキストをSOAPノートに変換してください。

【既存のSOAP-S（問診票から入力済み）】
${existingSoapS || "（なし）"}

【診察中の会話テキスト（音声書き起こし）】
${transcript}

以下のJSON形式で出力してください:
{
  "soap_s": "患者の主訴と自覚症状（既存のSOAP-Sの内容も統合）",
  "soap_o": "検査所見・口腔内所見（略語使用OK）",
  "soap_a": "歯番号+診断名",
  "soap_p": "本日の処置内容 + 処方薬（薬名・用量・日数）+ 次回の予定",
  "tooth_updates": {"45": "treated"},
  "procedures": ["FMC形成", "連合印象", "浸麻", "処方"],
  "diagnoses": [
    {"name": "う蝕（C2）", "tooth": "45", "code": "K022"}
  ]
}

diagnoses注意事項:
- 会話中に明示的に言及された傷病名のみを含める
- 推測で追加しない。例: C2と診断されたのに歯周炎(P)も追加、はNG
- toothはFDI番号（2桁）。全顎的な場合は空文字
- 主要コード: K020=CO, K021=C1, K022=C2, K023=C3, K024=C4, K040=Pul, K041=歯髄壊死, K045=Per, K046=歯根嚢胞, K050=G, K051=P, K052=歯周膿瘍, K054=P1, K055=P2, K056=P3, K081=Perico, K083=埋伏歯, K076=TMD, K120=Hys, K130=咬合性外傷, K003=破折, K001=欠損, K300=補綴物不適合, K301=二次う蝕

tooth_updatesの値: caries / treated / crown / missing / implant / bridge

proceduresに含める処置名は、auto-billing（自動算定）のキーワードマッチに使われます。
正確な処置名を使用してください:
FMC, CAD/CAM冠, 前装冠, インレー, CR充填, ブリッジ, 抜髄, 感根治, 根充, SC, SRP, 普通抜歯, 難抜歯, 装着, TEK, 印象, 連合印象, 浸麻, 咬合採得`;

      // GPT-4oで試行、失敗したらGPT-4o-miniにフォールバック
      const models = ["gpt-4o", "gpt-4o-mini"];
      let gptSuccess = false;

      for (const model of models) {
        try {
          const gptResponse = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: model,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
              temperature: 0.1,
              max_tokens: 2000,
              response_format: { type: "json_object" },
            }),
          });

          if (!gptResponse.ok) {
            console.error(`${model} error:`, await gptResponse.text());
            continue;
          }

          const gptResult = await gptResponse.json();
          const content = gptResult.choices?.[0]?.message?.content || "";
          
          // JSONをパース
          const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          soapData = JSON.parse(jsonStr);
          gptSuccess = true;
          break;
        } catch (modelErr) {
          console.error(`${model} parse error:`, modelErr);
          continue;
        }
      }

      if (!gptSuccess || !soapData) {
        return NextResponse.json({
          success: true,
          transcript,
          soap: {
            s: existingSoapS ? `${existingSoapS}\n\n【音声記録】${transcript}` : transcript,
            o: "",
            a: "",
            p: "",
          },
          tooth_updates: {},
          procedures: [],
          diagnoses: [],
          warning: "AI SOAP変換に失敗しました。文字起こしテキストをS欄に追加しました。手動で編集してください。"
        });
      }
    } catch (gptErr) {
      console.error("GPT exception:", gptErr);
      return NextResponse.json({
        success: true,
        transcript,
        soap: { s: transcript, o: "", a: "", p: "" },
        tooth_updates: {},
        procedures: [],
        diagnoses: [],
        warning: "SOAP変換でエラーが発生しました"
      });
    }

    return NextResponse.json({
      success: true,
      transcript,
      soap: {
        s: soapData.soap_s || "",
        o: soapData.soap_o || "",
        a: soapData.soap_a || "",
        p: soapData.soap_p || "",
      },
      tooth_updates: soapData.tooth_updates || {},
      procedures: soapData.procedures || [],
      diagnoses: soapData.diagnoses || [],
    });

  } catch (error) {
    console.error("Voice analyze error:", error);
    return NextResponse.json({ error: "サーバーエラーが発生しました" }, { status: 500 });
  }
}
