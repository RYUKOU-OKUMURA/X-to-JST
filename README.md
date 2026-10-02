# X to JST

X（x.com）のポストに含まれる海外時間表現を、その場で日本時間（JST）へ変換して表示する Chrome 拡張機能です。

## Concept

> **計算はコード、曖昧な判断はJev。**

- ポスト本文と投稿日時を取得
- `tomorrow` / `next Friday` などを投稿時刻基準で解釈
- IANA timezone と DST（夏時間）を使って決定論的にJSTへ変換
- `PST` と書かれているが実際は `PDT` 期間、などの曖昧なケースだけ TypeSafe Jev で候補を評価
- Jev の確信度が低い場合は、1つに断定せず複数候補を表示

## MVP

X上のポストに **「🇯🇵 日本時間」** ボタンを追加し、クリックするとその場でJSTを表示します。

結果は「向こうの日時とUTC差 → 日本の日時・コピー」の行で表示します。複数候補は未確定と明示し、元の表現・夏時間の注意・検証済みのJev判定と確信度は、閉じた「詳細」欄で確認できます。
Jevの応答がある場合は、各日本時間の横にその解釈の確率を表示します。判断保留の確率も表示し、候補の確率と分布全体の確信度を区別します。Jevを呼ばない結果や取得失敗には確率を付けません。

例:

```text
Tomorrow at 10am PST
```

↓

```text
🇯🇵 10月3日（土）02:00

⚠️ 原文はPST表記ですが、
この日付の米西海岸はPDT期間です。
```

## Tech Stack

- Chrome Extension Manifest V3
- TypeScript
- Vanilla DOM + CSS
- esbuild
- chrono-node
- Luxon
- TypeSafe Jev API
- Vitest

## Documents

- [要件定義](docs/requirements.md)
- [技術スタック](docs/tech-stack.md)
- [アーキテクチャ](docs/architecture.md)

## Status

v0.3.0 — JST conversion, on-demand research, and inline purpose search are implemented. Research acceptance remains incomplete; confirmed behavior and remaining evaluation are recorded in [docs/research-validation.md](docs/research-validation.md).

## Local development

Use Node.js 24 (`nvm use` if available).

```sh
npm ci
npm run check
```

Build artifacts are written to `dist/`. In Chrome, open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose `dist/`. Open X and click **🇯🇵 日本時間** beside a post.

For development, run `npm run watch`. After a rebuild, reload the extension from `chrome://extensions` and reload the X tab. Options, manifest, and style changes are also watched. No API key is needed for unambiguous PT/ET/UTC/GMT conversions.

Open the extension's **Extension options** to save or delete your TypeSafe key. Ambiguous time conversions and explicit research searches send their target text to TypeSafe; the key is handled in the background and is never returned to the X page. Time-conversion history is not persisted. Local storage is not an encrypted secret vault.

## X 調べもの

### ブックマーク・X検索結果で目的検索

ブックマーク一覧とX検索結果の中央列に「目的で探す」を表示します。X標準の「ブックマークを検索」または通常検索でキーワードを検索し、表示された投稿から「Workspace StudioとGASを連携した実例」のように目的を入力して「探す」を押してください。Jevが目的との関連を判定し、候補を中央列に表示します。「文字で探す」はAPIキー不要です。

対象はクリック時点までに読み込んだ表示本文です。全ブックマーク・X全体の網羅検索ではありません。「さらに読み込む」でXの一覧を手動スクロールし、再判定できます。最大200件・2MiBで、投稿本文は検索中のメモリにだけ保持します。通常表示に戻る・中断・目的変更・画面移動で破棄し、この検索から永続保存はしません。

「探す」は目的・表示本文・投稿日時をTypeSafeへ送信します。画像・動画・リンク先本文は対象外です。著者情報はXの画面表示に使い、Jevへ送りません。候補の関連性は内容の正確さを保証しません。元の投稿を開いて確認できます。拡張アイコンで検索欄を表示・非表示にできます。

### 既存の保存投稿・メモ

その他のX画面で拡張アイコンを押すと、既存の保存投稿パネルを開けます。以前の保存データは維持します。

- **拾う**：収集を開始し、手動スクロールで読み込んだ投稿を選んで保存。時刻表現のない投稿も対象です。
- **探す**：保存投稿を目的に合わせてJevで判定し、近い候補を先に表示。「文字で探す」はAPIキーなしで使えます。
- **つなげる**：「これとつなげる」で1投稿を選び、保存投稿から続報・具体例などの候補を比較します。

ブックマーク・タイムライン・検索結果など、画面に読み込んだ投稿を「拾う」で保存してから、「Google Workspaceで議事録を自動化したい」のように用途を入力して探します。X全体や未保存のブックマークを新しく検索する機能ではありません。

検索後の「その他の投稿」は関連が弱い投稿・関係が不明な投稿・未判定分を折りたたんでいます。本文は短いプレビューから全文を開けます。メモと投稿削除は各投稿の「メモ・管理」（長い本文は「全文・メモ・管理」）、書き出し・復元・全件削除は下部の「バックアップ・管理」から操作します。

保存はこのブラウザ内の最大200件・本文とメモ合計2MiBです。任意メモ、JSON書き出し・復元・削除に対応。復元は既存の本文とメモを保持し、未登録の投稿だけ追加します。拡張削除で保存データも失われます。

Jev検索では目的・対象の表示本文・投稿日時を送ります。本人メモはチェックを入れた場合のみ送信します。画像・動画・リンク先全文・まだ読み込んでいない過去投稿は検索しません。判定は候補で、原文と日付を確認できます。普段の閲覧中に新機能が自動収集・保存・送信することはありません。

設計と評価条件は [調べものモードの計画](docs/research-mode-plan.md)、実測範囲は [検証記録](docs/research-validation.md) を参照してください。

```sh
npm run test:browser  # compiled UI with mock Chrome runtime and X fixtures
npm run test:chrome   # real unpacked extension; requires a permissive Chromium policy
```

Both commands use `/usr/bin/chromium` by default; set `CHROMIUM_PATH` for another compatible Chromium executable. `test:chrome` requires support for the CDP `Extensions.loadUnpacked` command and must not be used to bypass an administrator's extension policy. Screenshots and machine-readable results are saved under `test-results/`.

An optional, explicit `npm run test:jev` sends one synthetic post to the real TypeSafe API using `TYPESAFE_API_KEY` from your environment. It can incur API charges and is never part of CI.

## Display and Jev evidence

- 日本時間ボタンは、既存パーサーで対応する日時・タイムゾーンが見つかった投稿だけに表示します。本文の差し替えに合わせて追加・除去します。
- 候補には「夏時間として読む」「PST表記どおりに読む」等の解釈を表示し、「なぜ2候補？・詳細」で理由を確認できます。向こうの時刻 → 日本時間、候補確率、コピーは維持します。
- Jevには現在の表示本文と、コードで算出したUTC差・夏時間の有無・表記との差を渡します。夏時間との食い違いだけで著者の意図を決めず、根拠が足りなければ未確定にします。確信度の向上を保証する変更ではありません。
- Xの日本語翻訳表示では英語原文がDOMから置換されるため、過去の原文キャッシュや自動の言語切替は追加しません。英語表示時は現在の英語本文を使います。API呼び出しは従来どおり曖昧な投稿のボタンクリック時のみです。

## Date interpretation rules

- `today`, `tonight`, and `tomorrow` use the posting date in each candidate's time zone. A time must be explicitly stated.
- Xの日本語翻訳表示も、そのまま解析します。例: `明日午前10時PST`、`今日午後7時PDT`、`今夜午後7時PDT`、`2026年10月2日15時 UTC`。英語との重複候補と単独の `now` は除き、実際の複数時刻・時間範囲は引き続き拒否します。日本語の相対日付は対応語に限定し、`明後日`・`来週`・`翌週`・`毎週`・`翌月`・`毎月` 等の既知の未対応修飾語を検出した場合は拒否します。自由な日本語の日時表現すべてに対応するものではありません。
- A bare weekday means that weekday on or after the local posting date. `next Friday` means Friday in the next ISO week (weeks start on Monday).
- A month/day with no year uses the local posting year, without rolling to another year. A time with no date uses the local posting day. Both require a valid posting timestamp.
- Fully specified year/month/day/time/zone works without a posting timestamp.
- DST gaps are never silently normalized. DST overlaps retain both valid instants.
- US abbreviations map to Los Angeles, New York, Chicago, and Denver. `CST` is not interpreted as China time. Multiple independent dates/ranges/zones, unsupported relative expressions, and nonzero seconds are explicitly rejected.
- Low confidence, an unresolved answer, an unset key, or an API failure retains the code-generated candidates. Jev never computes a date or time.

## License

未定
