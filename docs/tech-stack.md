# X to JST — 技術スタック v0.1

最終更新: 2026-10-02

## 1. 技術選定方針

X to JST は個人利用のChrome拡張MVPとして開始する。

優先順位:

1. 正確な日時計算
2. 小さく単純
3. デバッグしやすい
4. APIキーをXページから隔離
5. 将来のChrome Web Store公開へ移行しやすい

フレームワークを増やしすぎず、Vanilla TypeScriptを基本とする。

---

## 2. 採用スタック

| 領域 | 採用 | 用途 |
|---|---|---|
| Extension Platform | Chrome Extension Manifest V3 | Chrome拡張本体 |
| Language | TypeScript | 型安全な実装 |
| UI | Vanilla DOM + CSS | ボタン・結果カード・設定画面 |
| Build | esbuild | content/background/optionsをbundle |
| Date parsing | chrono-node | 英語の自然日時表現解析 |
| Timezone / DST | Luxon | IANA timezone・JST変換 |
| AI decision | TypeSafe Jev API | 曖昧な候補解釈のChoice |
| Testing | Vitest | 日時ロジックのunit test |
| Chrome types | @types/chrome | Chrome API型定義 |
| Storage | chrome.storage.local | APIキー・設定保存 |
| Backend | なし（MVP） | 個人利用のため |
| DB | なし | 不要 |

---

## 3. Chrome Extension

### Manifest
`manifest_version: 3`

主要構成:

```text
manifest.json
src/
  content/
  background/
  options/
  core/
  types/
```

### permissions

MVPで必要な最小構成:

```json
{
  "permissions": ["storage"],
  "host_permissions": [
    "https://x.com/*",
    "https://api.typesafe.ai/*"
  ]
}
```

`content_scripts` は `https://x.com/*` に静的注入する。

`chrome.scripting` はMVPでは不要。
`tabs` も原則不要。

---

## 4. TypeScript

採用理由:

- Jevレスポンスを型として扱える
- 日時計算データ構造を明確にできる
- content script と service worker 間のmessage型を共通化できる
- Claude Code / Codexから保守しやすい

主要型の例:

```ts
type ExtractedTimeExpression = {
  raw: string;
  relativeDate?: string;
  localTime: string;
  timezoneToken: string;
};

type TimeCandidate = {
  id: string;
  sourceZone: string;
  targetIsoJst: string;
  reason: string;
};

type ResolutionResult =
  | { status: "resolved"; candidate: TimeCandidate; warning?: string }
  | { status: "ambiguous"; candidates: TimeCandidate[]; warning: string }
  | { status: "unsupported"; reason: string };
```

---

## 5. chrono-node

用途:
- `tomorrow at 10am`
- `next Friday at 2pm`
- `October 5 at 9am`

などの自然言語日時を解析する。

重要:
- chrono-nodeの出力だけで最終日時を確定しない
- timezone略称の意味は別レイヤーで処理する
- 投稿日時をreference dateとして渡す

責務:
- 日付・時刻表現の抽出
- relative dateの基本解決

責務外:
- `PST`を固定offsetで読むかPacific Timeとして読むかの最終判断
- JSTへの変換ルール

---

## 6. Luxon

用途:
- IANA timezone
- DST
- UTC/JST変換
- ISO日時処理
- フォーマット

MVPではブラウザ標準Temporalへ全面依存しない。

理由:
- Temporalは2026-10時点でもブラウザ互換性が完全ではない
- LuxonはIntlのtime zone機能を使い、MVPで必要なIANA zone変換を簡潔に実装できる

基本ゾーン:

```text
Asia/Tokyo
America/Los_Angeles
America/New_York
America/Chicago
America/Denver
UTC
```

---

## 7. タイムゾーン辞書

コード側で明示的に管理する。

例:

```ts
const ZONES = {
  PT:  { kind: "iana", zone: "America/Los_Angeles" },
  ET:  { kind: "iana", zone: "America/New_York" },
  CT:  { kind: "iana", zone: "America/Chicago" },
  MT:  { kind: "iana", zone: "America/Denver" },

  PDT: { kind: "fixed", offsetMinutes: -7 * 60, region: "America/Los_Angeles" },
  PST: { kind: "fixed", offsetMinutes: -8 * 60, region: "America/Los_Angeles" },

  EDT: { kind: "fixed", offsetMinutes: -4 * 60, region: "America/New_York" },
  EST: { kind: "fixed", offsetMinutes: -5 * 60, region: "America/New_York" }
};
```

`PST` のような略称は以下2候補を作れるようにする。

- fixed offset
- region civil time

この差をJevへ渡す。

---

## 8. TypeSafe Jev API

### Endpoint

```text
POST https://api.typesafe.ai/v1/systemone
```

### Authentication

```http
Authorization: Bearer <API_KEY>
```

### Model

```text
jev-latest
```

利用可能モデルは必要に応じて:

```text
GET https://api.typesafe.ai/v1/models
```

で確認する。

### 採用するPrimitive

MVPでは主に **Choice** を使う。

Jevは文字列を生成させるのではなく、こちらが用意した候補から選ばせる。

---

## 9. Jev request例

```json
{
  "model": "jev-latest",
  "state": {
    "tweet_text": "Tomorrow at 10am PST, we'll reset all paid accounts.",
    "posted_at_utc": "2026-10-02T02:14:00Z",
    "expression": "Tomorrow at 10am PST",
    "candidates": {
      "regional_pacific": {
        "meaning": "PST is used loosely to mean Pacific Time on that date.",
        "jst": "2026-10-03T02:00:00+09:00"
      },
      "literal_pst": {
        "meaning": "PST means fixed UTC-8 literally.",
        "jst": "2026-10-03T03:00:00+09:00"
      }
    }
  },
  "questions": {
    "timezone_intent": {
      "type": "choice",
      "instructions": "Choose the interpretation most likely intended by the author. Do not invent context. Choose unresolved if the text does not support a reliable preference.",
      "criteria": {
        "regional_pacific": "The author is using PST colloquially to mean Pacific Time for the stated date.",
        "literal_pst": "The author intentionally means fixed UTC-8 even if daylight saving time is active.",
        "unresolved": "There is not enough evidence to reliably prefer either interpretation."
      }
    }
  }
}
```

期待レスポンス概念:

```json
{
  "answers": {
    "timezone_intent": {
      "type": "choice",
      "choice": "regional_pacific",
      "confidence": 0.91,
      "probabilities": {
        "regional_pacific": 0.88,
        "literal_pst": 0.07,
        "unresolved": 0.05
      }
    }
  }
}
```

---

## 10. Jevを使う箇所

### 使う
- DSTと略称表記が矛盾
- 複数解釈が成立
- 文脈から候補を選ぶ必要がある

### 使わない
- `UTC`
- `GMT`
- `PT`
- 明示offset
- 単純な時差計算
- 日付加算
- 曜日算出
- JSTフォーマット

原則:

> Jevには「計算結果候補」を渡す。Jevに計算させない。

---

## 11. APIキー管理

### MVP
設定画面からユーザーが自分のTypeSafe APIキーを入力。

保存先:

```text
chrome.storage.local
```

起動時に:

```ts
chrome.storage.local.setAccessLevel({
  accessLevel: "TRUSTED_CONTEXTS"
});
```

を設定し、content scriptから直接アクセスできない状態にする。

### 禁止
- ソースコードに埋め込む
- manifestへ書く
- DOMへ書く
- console.logへ出す
- content scriptへmessageで渡す

### 注意
`chrome.storage.local` を「秘密情報用の暗号化金庫」とは扱わない。
個人利用MVPとしての利便性を優先する。

一般公開時はバックエンドproxyへ移行する。

---

## 12. Service Worker

責務:
- TypeSafe API Keyを読む
- Jev APIを呼ぶ
- responseを検証する
- content scriptへ判定結果だけ返す

content scriptからのmessage例:

```ts
{
  type: "RESOLVE_AMBIGUITY",
  payload: {
    tweetText: "...",
    postedAtUtc: "...",
    expression: "...",
    candidates: [...]
  }
}
```

返却:

```ts
{
  ok: true,
  choice: "regional_pacific",
  confidence: 0.91,
  probabilities: {...}
}
```

---

## 13. Content Script

責務:
- X DOM監視
- ポスト検出
- ボタン追加
- 本文取得
- `time[datetime]` 取得
- coreロジック呼び出し
- 結果描画

XはSPAかつ無限スクロールのため `MutationObserver` を使用。

処理済みポストには拡張独自のdata属性を付ける。

例:

```text
data-x-to-jst-initialized="true"
```

---

## 14. UI

Reactは使わない。

理由:
- UIが小さい
- ボタン1つと結果カードだけ
- Bundleと保守を増やす必要がない

使用:
- DOM API
- CSS
- `textContent`

外部HTMLをそのまま `innerHTML` に流さない。

---

## 15. Build

### esbuild

entry points:

```text
src/content/index.ts
src/background/index.ts
src/options/index.ts
```

output:

```text
dist/
  manifest.json
  content.js
  background.js
  options/
  styles/
  icons/
```

npm scripts例:

```json
{
  "scripts": {
    "build": "node scripts/build.mjs",
    "watch": "node scripts/build.mjs --watch",
    "test": "vitest run"
  }
}
```

---

## 16. テスト

最重要は日時ロジック。

### Unit Test
- PST/PDT境界
- EST/EDT境界
- DST開始日
- DST終了日
- 年跨ぎ
- `tomorrow`
- `next Friday`
- UTC→JST
- 日付変更線を跨ぐケース

### Jev integration test
- mockを基本
- 実APIテストは手動または明示的なintegration scriptのみ
- APIキーをCIへ必須にしない

### DOM test
最低限:
- ポスト検出
- ボタン重複防止
- 本文取得失敗
- timestamp取得失敗

---

## 17. 依存パッケージ

runtime:

```text
chrono-node
luxon
```

dev:

```text
typescript
esbuild
vitest
@types/chrome
@types/luxon
```

それ以上は必要になるまで増やさない。

---

## 18. 採用しないもの

MVPでは不採用:

- React
- Next.js
- Firebase
- Supabase
- Prisma
- PostgreSQL
- Express
- Cloudflare Workers
- Vercel Functions
- X API
- OpenAI API
- Anthropic API
- Redux
- Tailwind CSS

理由:
現在のMVP要件には不要。

---

## 19. 公式仕様参照

### Chrome Extensions
- https://developer.chrome.com/docs/extensions/
- https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/
- https://developer.chrome.com/docs/extensions/reference/api/storage

### TypeSafe / Jev
- https://api.typesafe.ai/docs
- https://api.typesafe.ai/openapi.json
- https://typesafe.ai/

### Temporal
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal