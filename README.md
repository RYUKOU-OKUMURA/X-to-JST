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

v0.1 — MVP specification

## License

未定
