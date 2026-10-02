# 選択2：中央列目的検索のQA

- Source visual truth: `/Users/ryukouokumura/.codex/generated_images/01a0fbae-8134-7bc2-9271-53896527a73d/exec-8114b577-1c04-4ffb-afdd-7eaa015f14aa.png`。
- Implementation capture: `/Users/ryukouokumura/Desktop/boss-workspace/X-to-JST/test-results/comet-inline-results.png`（途中版）。
- Source: 1487×1058 pixels、生成画像のためCSS viewport/density不明。Comet: 1910×918 pixels、CSS viewport 1910×918、devicePixelRatio 1。中央列はmock約758pxとnative598pxで異なる。native X列幅を維持し、ピクセル単位の一致とはしない。
- State: dark、候補表示。sourceは架空の40件/3候補・議事録目的、実機は実6件/1候補・進捗可視化目的。投稿数/本文/著者を同一として比較しない。
- Full comparison input: sourceとComet screenshotを同じtool resultの2画像として開いて比較。左右並列の合成画像は未作成。Comet localhost比較ページがblocked by clientとなったため、厳密な並列比較・最終修正の再撮影は未完了。
- Focused region: 中央検索欄と最初の候補の文言はフル画像で読み取れた。最終状態のfocused captureは未取得。

## Findings・履歴

1. [P2] 候補下にnative feedも残った。実画面でhidden属性をXのdisplay:flexが上書き。display none!importantと元の値/priority復元を実装し、実Cometでnone→flexを確認。保存captureではnative feedが消えた。
2. [P2] 検索controlsがsourceより縦に大きく、完了後にcollectorが取得状況へstatusを上書き。送信説明をnative detailsへ折りたたみ、送信自体は常時helpに明示。statusを12pxにし、判定対象固定中はcollectorで上書きしない修正を実装。最終Cometの再撮影は未確認なのでclosed扱いにしない。
3. [P2] host.hiddenもhost display:blockに負ける可能性を独立レビューで発見。:host([hidden]) display none!importantを追加。mock browserの開閉computed displayチェックを追加。実Comet toolbar開閉は未確認。

## 五つの表面

- Typography: system sans-serif、18px見出し/15px著者/16px本文。native列内で本文が読める。元画像より小さいが、mock列とnative列の寸法差を考慮。最終12pxstatusは実機未確認。
- Spacing/layout: 中央入力→件数/戻る→候補の構成は一致。598px native列を維持。controlsの縦密度修正は再撮影待ち。
- Colors/tokens: black surface、light foreground、X青の主ボタン/リンク。既存ページ色を使う。light themeは未確認。
- Assets: native X著者avatarを再利用し、架空avatarは追加していない。sourceの虫眼鏡/外部リンクアイコンは今回省略（P3）。navigationはX提供の現行UIを維持。
- Copy: 目的検索・判定対象件数・通常復帰・元投稿の導線。全件検索や真偽保証を表示しない。sourceのサンプル文言は実投稿に置換。

## Checks / remaining

- 181 tests/typecheck/build、Chrome154実MV3 fixture通過。
- 実Comet途中版でJev6→1、local3、native非表示/通常復帰を確認。
- Final Comet capture、narrow/light、toolbar toggle、最終console確認は未完了。管理画面空表示の原因は未確定、localhostもERR_BLOCKED_BY_CLIENT。保護の解除や別ブラウザの成功をComet完了扱いにしていない。
- 最終ビルドをCometの既存拡張から再読み込みし、Xタブ再読み込み後に同状態を撮影して再比較する。

final result: blocked
