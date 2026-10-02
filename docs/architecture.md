# X to JST — アーキテクチャ設計 v0.1

最終更新: 2026-10-02

## 1. アーキテクチャ概要

MVPは **Chrome拡張単体 + TypeSafe Jev API**。

独自バックエンド、DB、ログインは持たない。

```text
┌──────────────────────────────────────┐
│                X.com                 │
│                                      │
│  Post                                │
│  "Tomorrow at 10am PST..."           │
│       │                              │
│       ▼                              │
│  [🇯🇵 日本時間]                      │
└───────┬──────────────────────────────┘
        │
        │ DOM
        ▼
┌──────────────────────────────────────┐
│ Content Script                       │
│                                      │
│  1. tweet本文取得                    │
│  2. 投稿日時取得                     │
│  3. 日時表現抽出                     │
│  4. core resolver呼び出し            │
│  5. 結果UI表示                       │
└───────┬──────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────┐
│ Core Time Resolver                   │
│                                      │
│ chrono-node                          │
│ + Luxon                              │
│ + timezone dictionary                │
│                                      │
│ 明確 → JST確定 ───────────────┐      │
│ 曖昧 → Candidate A/B生成       │      │
└───────┬────────────────────────┘      │
        │                               │
        │ only if ambiguous             │
        ▼                               │
┌──────────────────────────────────────┐│
│ Background Service Worker            ││
│                                      ││
│ API Key保持                          ││
│ Jev API client                       ││
└───────┬──────────────────────────────┘│
        │                               │
        │ HTTPS                         │
        ▼                               │
┌──────────────────────────────────────┐│
│ TypeSafe Jev                         ││
│ POST /v1/systemone                   ││
│ Choice → confidence/probabilities    ││
└───────┬──────────────────────────────┘│
        │                               │
        └──────── selected candidate ───┘
                        │
                        ▼
                  JST結果を表示
```

---

## 2. コンポーネント責務

### 2.1 Content Script

ファイル例:

```text
src/content/index.ts
src/content/x-dom.ts
src/content/ui.ts
```

責務:
- Xのポストを監視
- 対象ポストへボタンを挿入
- クリックイベント処理
- 本文取得
- timestamp取得
- resolverへデータを渡す
- 結果UI描画

責務外:
- APIキー取得
- Jev直接呼び出し
- タイムゾーン判断ロジックの実装

---

### 2.2 X DOM Adapter

```text
src/content/x-dom.ts
```

X固有DOMを1ファイルへ隔離する。

想定取得:

```text
article[data-testid="tweet"]
div[data-testid="tweetText"]
time[datetime]
```

重要:
XのDOM変更時に修正範囲をここへ限定する。

interface例:

```ts
type TweetContext = {
  text: string;
  postedAtUtc: string;
  url?: string;
};

function extractTweetContext(article: HTMLElement): TweetContext | null;
```

---

### 2.3 Time Expression Parser

```text
src/core/parser.ts
```

責務:
- 本文から日時表現を抽出
- chrono-nodeを使用
- timezone tokenを抽出
- relative date要素を保持

出力例:

```ts
{
  raw: "Tomorrow at 10am PST",
  dateKind: "relative",
  relativeToken: "tomorrow",
  time: { hour: 10, minute: 0 },
  timezoneToken: "PST"
}
```

---

### 2.4 Timezone Resolver

```text
src/core/timezone.ts
```

責務:
- 略称からtimezone候補を取得
- IANA zone候補
- fixed offset候補
- DST矛盾検出

例:

```text
PST
├─ literal: UTC-08:00
└─ regional: America/Los_Angeles
```

対象日を `America/Los_Angeles` で評価してoffsetが `-07:00` の場合:

```text
dstMismatch = true
```

---

### 2.5 Candidate Builder

```text
src/core/candidate-builder.ts
```

責務:
- すべての算術処理を行う
- Jevへ渡す前にJST候補を完成させる

入力:

```text
投稿timestamp
日時表現
timezone候補
```

出力:

```ts
[
  {
    id: "regional_pacific",
    sourceZone: "America/Los_Angeles",
    sourceDateTime: "2026-10-02T10:00:00-07:00",
    jstDateTime: "2026-10-03T02:00:00+09:00",
    reason: "Pacific Time civil time"
  },
  {
    id: "literal_pst",
    sourceZone: "UTC-08:00",
    sourceDateTime: "2026-10-02T10:00:00-08:00",
    jstDateTime: "2026-10-03T03:00:00+09:00",
    reason: "Literal PST fixed offset"
  }
]
```

ここまでJevは使わない。

---

## 3. 投稿日時の基準処理

相対日付の最重要ルール。

### 入力

```text
postedAtUtc = 2026-10-02T02:14:00Z
expression = Tomorrow at 10am PST
```

### regional candidate

1. `postedAtUtc` を `America/Los_Angeles` へ変換
2. 現地日付を取得
3. `tomorrow` → +1 calendar day
4. `10:00` を設定
5. 対象日のDST offsetをIANA zoneから取得
6. JSTへ変換

### literal candidate

1. `postedAtUtc` を `UTC-08:00` へ変換
2. 現地日付を取得
3. `tomorrow` → +1 calendar day
4. `10:00 -08:00`
5. JSTへ変換

この2結果が異なるためJev判断対象となる。

---

## 4. Jev Adapter

```text
src/background/jev-client.ts
```

Jev固有のAPI仕様を1か所に隔離。

interface:

```ts
type JevChoiceResult = {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};

async function chooseTimeInterpretation(
  state: JevTimeState
): Promise<JevChoiceResult>;
```

これによりTypeSafe API変更時もcoreロジックへの影響を最小化する。

---

## 5. Jevへ送るstate

送信情報は最小限。

```ts
{
  tweet_text: string,
  posted_at_utc: string,
  extracted_expression: string,
  candidates: {
    [candidateId]: {
      interpretation: string,
      source_datetime: string,
      jst_datetime: string
    }
  }
}
```

送らない:
- ブラウザ履歴
- Xログイン情報
- Cookie
- APIキー以外の秘密情報
- 関係ない他ポスト

---

## 6. Jev Choice設計

候補例:

```text
regional_pacific
literal_pst
unresolved
```

重要:
`unresolved` を必ず入れる。

理由:
Jevに無理やりA/Bを選ばせないため。

---

## 7. Resolution Policy

```ts
function resolveJevChoice(result, candidates) {
  if (result.choice === "unresolved") {
    return ambiguous(candidates);
  }

  const sorted = Object.entries(result.probabilities)
    .sort((a, b) => b[1] - a[1]);

  const gap = sorted[0][1] - sorted[1][1];

  if (result.confidence >= 0.80 && gap >= 0.25) {
    return resolved(result.choice);
  }

  return ambiguous(candidates);
}
```

Jevの結果をそのまま盲信せず、アプリ側のpolicyで最終判断する。

---

## 8. Message Passing

### Content → Background

```ts
chrome.runtime.sendMessage({
  type: "RESOLVE_TIME_AMBIGUITY",
  payload: {
    tweetText,
    postedAtUtc,
    expression,
    candidates
  }
});
```

### Background → Content

成功:

```ts
{
  ok: true,
  result: {
    choice: "regional_pacific",
    confidence: 0.91,
    probabilities: {
      regional_pacific: 0.88,
      literal_pst: 0.07,
      unresolved: 0.05
    }
  }
}
```

失敗:

```ts
{
  ok: false,
  error: {
    code: "JEV_UNAVAILABLE",
    message: "Jev判定を取得できませんでした"
  }
}
```

APIキー自体はmessage payloadへ含めない。

---

## 9. APIキーの流れ

```text
Options Page
   │
   │ save
   ▼
chrome.storage.local
   │
   │ TRUSTED_CONTEXTS only
   ▼
Background Service Worker
   │
   │ Authorization: Bearer ...
   ▼
TypeSafe API
```

Content Script:
- APIキーへアクセスしない
- APIキーを知らない

---

## 10. X SPA対応

Xはページ遷移で完全reloadされない。

そのため:

```text
MutationObserver
   ↓
新しいarticle[data-testid="tweet"]検出
   ↓
未処理か確認
   ↓
ボタン追加
```

重複防止:

```text
data-x-to-jst-initialized
```

observer callbackでは重い日時解析をしない。
解析はボタン押下時のみ。

これによりスクロール性能を落としにくい。

---

## 11. 処理シーケンス

```text
User
 │
 │ click "🇯🇵 日本時間"
 ▼
Content Script
 │
 ├─ tweet text取得
 ├─ postedAt取得
 │
 ▼
Parser
 │
 ├─ datetime expression抽出
 │
 ▼
Timezone Resolver
 │
 ├─ 一意？
 │      │
 │      ├─ YES → Candidate Builder → JST → UI
 │      │
 │      └─ NO
 │
 ▼
Candidate Builder
 │
 ├─ Candidate A
 ├─ Candidate B
 │
 ▼
Background Service Worker
 │
 ▼
Jev API
 │
 ▼
Choice + confidence
 │
 ▼
Resolution Policy
 │
 ├─ confident → single result
 └─ uncertain → candidates
 │
 ▼
Content Script UI
```

---

## 12. エラー設計

### E-01 本文取得失敗
表示:
`ポスト本文を取得できませんでした。`

### E-02 投稿日時取得失敗
relative dateがある:
`投稿日時を取得できないため、相対日時を確定できません。`

絶対日時のみ:
可能なら続行。

### E-03 日時表現なし
`変換できる日時表現が見つかりませんでした。`

### E-04 タイムゾーンなし
`タイムゾーンを特定できませんでした。`

MVPでは勝手に投稿者所在地を推測しない。

### E-05 Jev APIキー未設定
`TypeSafe APIキーを設定してください。`

設定画面への導線を表示。

### E-06 Jev API失敗
候補がある:
候補を両方表示。

### E-07 Jev低confidence
候補を両方表示。

---

## 13. キャッシュ

MVPでは永続キャッシュ不要。

service workerまたはcontent scriptメモリ内で:

```text
tweet URL + expression + candidate hash
```

をkeyに短時間キャッシュしてよい。

目的:
同じボタン連打でJev APIを重複呼び出ししない。

ブラウザ再起動後まで保存する必要はない。

---

## 14. ディレクトリ案

```text
x-to-jst/
├─ manifest.json
├─ package.json
├─ tsconfig.json
├─ scripts/
│  └─ build.mjs
├─ src/
│  ├─ background/
│  │  ├─ index.ts
│  │  └─ jev-client.ts
│  ├─ content/
│  │  ├─ index.ts
│  │  ├─ x-dom.ts
│  │  ├─ observer.ts
│  │  └─ ui.ts
│  ├─ core/
│  │  ├─ parser.ts
│  │  ├─ timezone.ts
│  │  ├─ candidate-builder.ts
│  │  ├─ resolver.ts
│  │  └─ formatter.ts
│  ├─ options/
│  │  ├─ index.html
│  │  ├─ index.ts
│  │  └─ options.css
│  └─ types/
│     └─ messages.ts
├─ tests/
│  ├─ parser.test.ts
│  ├─ timezone.test.ts
│  ├─ resolver.test.ts
│  └─ dst.test.ts
└─ assets/
   └─ icons/
```

---

## 15. テストケース例

### Case A: PST表記 / PDT期間

```text
post UTC: 2026-10-02T02:14:00Z
text: Tomorrow at 10am PST
```

期待:
- regional Pacific candidateを生成
- fixed PST candidateを生成
- 結果は1時間差
- JevへChoice問い合わせ
- confidence低なら両方表示

### Case B: PT

```text
text: Tomorrow at 10am PT
```

期待:
- `America/Los_Angeles` として一意
- Jevを呼ばない
- DSTはコードで自動適用

### Case C: UTC

```text
text: Friday at 15:00 UTC
```

期待:
- Jevを呼ばない
- JSTへ直接変換

### Case D: timezoneなし

```text
text: Tomorrow at 10am
```

期待:
- 勝手に推測しない
- 「タイムゾーンを特定できません」

---

## 16. セキュリティ境界

信頼領域:

```text
Options Page
Background Service Worker
Core bundled code
```

低信頼領域:

```text
X DOM
tweet text
external API response
```

対策:
- Tweet本文は単なる文字列として扱う
- UI描画は `textContent`
- Jev responseはruntime validation
- 未知のchoiceは拒否
- API Keyはbackgroundのみ
- remote codeを実行しない

---

## 17. 将来のPublic版への移行

MVP:

```text
Extension → Jev API
```

Public:

```text
Extension
  ↓
X to JST API Proxy
  ↓
Jev API
```

Proxy追加時のみ:
- API Keyをserver secretへ移動
- rate limit
- abuse prevention
- usage analytics（必要な場合のみ）
- user authentication（必要なら）

現時点では作らない。

---

## 18. アーキテクチャ原則

1. **日時計算にAIを使わない**
2. **Jevには閉じた候補だけを選ばせる**
3. **低confidenceでは断定しない**
4. **X依存コードを分離する**
5. **API Keyをcontent scriptへ渡さない**
6. **明確な日時ではAPIを呼ばない**
7. **DBを持たない**
8. **backendを持たない**
9. **Reactを入れない**
10. **必要になるまで機能を増やさない**

---

## 19. MVPの完成形

ユーザー体験はこれだけでよい。

```text
Xを閲覧
  ↓
海外時刻のあるポストを見る
  ↓
「🇯🇵 日本時間」をクリック
  ↓
2秒以内を目安に結果
  ↓
🇯🇵 10月3日（土）02:00
```

曖昧なら:

```text
⚠️ 2つの解釈があります

02:00 JST — Pacific Time
03:00 JST — PSTをUTC-8として解釈
```

**速く、正確で、勝手に断定しない。**

これをv1の完成形とする。