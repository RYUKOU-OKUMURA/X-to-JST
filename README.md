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

結果は「日時・解釈の短いラベル・コピー」の行で表示します。複数候補は未確定と明示し、元の表現・夏時間の注意・検証済みのJev判定と確信度は、閉じた「詳細」欄で確認できます。

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

v0.1 — MVP implementation, awaiting live Chrome/X acceptance. The implementation and automated checks cover the plan in [#1](https://github.com/RYUKOU-OKUMURA/X-to-JST/issues/1); live acceptance results are recorded in [docs/validation.md](docs/validation.md).

## Local development

Use Node.js 24 (`nvm use` if available).

```sh
npm ci
npm run check
```

Build artifacts are written to `dist/`. In Chrome, open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose `dist/`. Open X and click **🇯🇵 日本時間** beside a post.

For development, run `npm run watch`. After a rebuild, reload the extension from `chrome://extensions` and reload the X tab. Options, manifest, and style changes are also watched. No API key is needed for unambiguous PT/ET/UTC/GMT conversions.

Open the extension's **Extension options** to save or delete your TypeSafe key. Only a clicked, ambiguous post is sent to TypeSafe; the key is handled in the background and is never returned to the X page. Conversion history and post bodies are not persisted. Local storage is not an encrypted secret vault.

```sh
npm run test:browser  # compiled UI with mock Chrome runtime and X fixtures
npm run test:chrome   # real unpacked extension; requires a permissive Chromium policy
```

Both commands use `/usr/bin/chromium` by default; set `CHROMIUM_PATH` for another compatible Chromium executable. `test:chrome` requires support for the CDP `Extensions.loadUnpacked` command and must not be used to bypass an administrator's extension policy. Screenshots and machine-readable results are saved under `test-results/`.

An optional, explicit `npm run test:jev` sends one synthetic post to the real TypeSafe API using `TYPESAFE_API_KEY` from your environment. It can incur API charges and is never part of CI.

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
