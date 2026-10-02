# v0.1 implementation and acceptance record

Date: 2026-10-02 (Japan time). Plan: [#1](https://github.com/RYUKOU-OKUMURA/X-to-JST/issues/1), implementation tasks #2–#9. This records a reviewed implementation, not a completed live-X acceptance.

## Automated results

- Node.js 24.19.0; Chromium 151.0.7922.173.
- `npm run check`: TypeScript strict checks, 89 Vitest tests, and a complete MV3 build passed.
- `npm run test:browser`: compiled content/options bundles passed the Chromium fixture smoke test. The Chrome runtime is mocked. Checks: unique JST rendering, API key save/reload/delete UI, unset-key candidate fallback, SPA/additional-post controls, clipboard copy, and absence of a key in the X DOM.
- Light/dark screenshots were inspected for readable times, interpretation labels, warnings, and candidate-specific copy controls. They are generated in `test-results/`.
- `npm run test:chrome`: blocked before the extension could load. Chromium reports `Loading of unpacked extensions is disabled by the administrator`; `/etc/chromium/policies/managed/extensions.json` sets `ExtensionInstallBlocklist: ["*"]`. That policy was not changed. Real storage isolation and MV3 lifecycle are unverified.
- Live X and paid TypeSafe API: not run. No user API key or X session was supplied. The browser smoke uses deterministic X fixtures.

## Requirement coverage

| Acceptance | Automated evidence | Remaining live check |
| --- | --- | --- |
| AC-01 relative date | core: Pacific posting day and UTC/local midnight boundaries | Representative X post |
| AC-02 PST/PDT candidates | core: both candidate instants, DST gaps/folds in four US regions | Representative X post |
| AC-03 high confidence | DOM/runtime mock: high-confidence candidate selected | Optional paid API result |
| AC-04 low confidence | DOM/runtime mock: low confidence and unresolved keep candidates | Optional paid API result |
| AC-05 unique time without API | core, DOM, worker: PT/UTC require no fetch | Chrome/X click |
| AC-06 dynamic posts | DOM and compiled-browser fixture: initial/additional posts, SPA | Real X scrolling/navigation |
| AC-07 no duplicate controls | DOM: repeated changes, observer reuse, recycled articles | Real X virtualization |
| AC-08 key isolation | worker: trusted storage gate, sender/payload validation, key-free response/state; browser fixture: key-free DOM | Real content-script storage denial and worker restart |
| AC-09 API failure | worker/UI: unset key, HTTP 401/429/500, timeout, malformed/contradictory response; candidates retained | Real service worker/network failure |
| AC-10 copy | formatter/DOM plus actual Chromium clipboard on fixture | Real X copy interaction |

## API contract evidence

The API documentation endpoint was unavailable under the executor's outbound policy. The adapter was instead checked against the official [`typesafe-ai/typesafe-sdk-js`](https://github.com/typesafe-ai/typesafe-sdk-js) package `@typesafe-ai/sdk@0.6.0`, retrieved from npm. Its published `ChoiceQuestion`, `ChoiceResponse`, client endpoint, Bearer authentication, and `jev-latest` default agree with the adapter's request/response structure. This is contract verification, not evidence of an authenticated live call.

Package integrity: `sha512-IddX+Q0XM+VagOUZFeP7wZjaO4SHMdvnh2zEBdrZZnXedWI3BNK1lKhMx3ayrkFWvVLbVcUHJy6AVZlY+e6Jaw==`.

The adapter requires a `choice` primitive, exactly the supplied candidate IDs plus `unresolved`, finite probabilities/confidence in [0,1], approximately normalized probabilities, and a choice consistent with the probability ranking. Auto-selection additionally requires confidence ≥ 0.80 and probability gap ≥ 0.25. Any failure preserves candidates. Duplicate concurrent requests share one call, and changing/deleting the key cancels pending judgments.

## Post-implementation review

A separate self-review pass checked date rules against the issue acceptance criteria, the content/background trust boundary, stale DOM behavior, and the build/watch flow. This is not an independent human approval.

Findings fixed and covered by regression tests:

1. Partial/malformed UTC offsets could be accepted: require a complete offset token and valid hour/minute range.
2. Chrono's other relative expressions could be interpreted using UTC-derived calendar values: reject unsupported relative rules rather than convert them as explicit dates.
3. Nonzero seconds could be truncated: explicitly reject them in the minute-based MVP.
4. X could recycle an article and remove its control, or retain a previous post's result: restore missing controls and clear stale results; ignore delayed replies for changed/removed posts.
5. A key deletion during a judgment could permit a stale selection: abort active calls and gate replies on the key revision.
6. A response of another Jev primitive could be accepted: require the official `choice` primitive before validating probabilities.

No known code blocker remains in the automated scope. Release readiness remains blocked on the live checks below. Keep the parent/implementation issues open until their manual completion conditions have been verified.

## Manual completion checklist

- [ ] Load `dist/` on an unmanaged/appropriately configured desktop Chrome, open its worker/options, and verify static injection on X.
- [ ] On actual X, verify ordinary posts, quotations opened separately, missing text/time, SPA navigation, infinite scrolling, and recycled posts without wrong timestamp ownership.
- [ ] Save/reload/delete a key and confirm content scripts cannot read `chrome.storage.local`; check DOM/messages/console and restart the service worker.
- [ ] Check candidate display and clipboard on X in both themes.
- [ ] Optionally run `npm run test:jev` with the user's configured key and record the authenticated model/contract result separately from mocks.
- [ ] Record the tested commit and Chrome version; update the AC table and close only conditions with actual evidence.

## 2026-10-02 translated-post regression fix

- The user's existing Comet tab (exposed by the browser connector as Chrome) was inspected at `https://x.com/thsottiaux/status/2105843926221660585`. X's translated `tweetText` contained Japanese with `lang="ja"`; selecting the original replaced it with English and `lang="en"`.
- Before the fix, the Japanese full post returned no date expression. The complete English original also failed: Chrono parsed both `tomorrow 10am` and the unrelated `now` as dates. Both errors were reproduced on the user's actual tab; testing only the opening English sentence had missed the second failure.
- The existing Chrono Japanese parsers/refiners now share its overlap/merge handling with English. Relative days still use each candidate's local posting date. Only standalone `now` is ignored; multiple clocks, ranges, nonzero seconds, and the explicitly guarded unsupported Japanese relative modifiers are rejected.
- `npm run check` passed: strict TypeScript, 116 tests, and the MV3 build. Regression checks cover the full English/Japanese post, local midnight/year boundaries, shared clock syntax, unsupported relative dates, ranges, and translated DOM input without changing its language. Independent review identified dropped `毎週`/`翌週`/`毎月`/`翌月` modifiers; explicit rejection and regressions were added before finalization.
- The installed extension's source was verified as this repository's `dist/`, then the extension and the same X tab were reloaded. With X's Japanese translation still displayed, the fixed extension rendered both `2026年10月3日（土）02:00 JST` and `03:00 JST`, retaining its ambiguity notice. No single candidate or authenticated API contract is asserted from this UI observation.
- The live article used a flex row with no wrapping, squeezing the result host to about 100 px. Wrapping the article and giving the host a full row made both the post and host 566 px wide, with results below the post. The final live screenshot was visually inspected.
- Immersive Translate's inserted elements were not observed inside this target post's text. General compatibility with its bilingual/translation-only modes, other X posts, and the remaining manual acceptance checks above remains unverified.

## 2026-10-02 compact result and Jev response evidence

- Removed the duplicate result heading and large bordered card. Each candidate now occupies a compact row with its complete JST date, a short interpretation label, and copy control. Explanation, DST warnings, and API settings (when no validated answer is available) use native closed `details`.
- Validated Jev answers retain their choice/confidence in the in-memory resolution and expose them in details. Malformed success replies are treated as unavailable, without an "応答確認済み" claim. Credentials and new persistent data were not added.
- `npm run check` passed: strict TypeScript, 118 tests, and build. Regressions verify validated judgment retention, malformed-success fallback, and compact rows with closed details. Candidate calculation and auto-selection thresholds are unchanged.
- Reloaded the existing installed extension and the same Comet X tab, preserving `lang="ja"`. For this actual post, the validated Jev reply chose the `02:00 JST` candidate with confidence `0.30`; the `0.80` confidence requirement prevented auto-selection, so both `02:00` and `03:00` remain visible. This confirms an authenticated, schema-validated API response for this request, not general service health or correctness of the model's interpretation.
- The closed result measured 129 px high at the user's current viewport. Mouse and keyboard opening/closing of details were verified; the visible details showed "TypeSafe / Jev：応答確認済み" and "確信度 30.0%". Dark-theme screenshots were inspected (`/tmp/x-to-jst-compact-20261002.jpg`, `/tmp/x-to-jst-jev-details-20261002.jpg`). Light theme, other translation modes, and the remaining broad acceptance checks remain unverified.
- The live official TypeSafe [API](https://docs.typesafe.ai/api), [Choice](https://docs.typesafe.ai/primitives/choice), and [confidence](https://docs.typesafe.ai/confidence) documentation were checked. The skill guides integration work; the extension calls the API at runtime. Confidence describes distribution concentration and is not proof of end-to-end correctness.

## 2026-10-02 source-to-Japan comparison

- User feedback showed that the two JST candidates and the label "現地時間" could be read as a source/Japan comparison. Candidate rows now explicitly show the interpreted source date/time and UTC offset, an arrow, and the JST date/time. Neither an ambiguous candidate nor its copy control is removed or silently selected; calculation and API thresholds are unchanged.
- The source formatter preserves the offset embedded in `sourceDateTime` with `setZone: true`. Automated checks include the two different offsets for the reported post and a source/Japan year boundary. `npm run check` passed with 119 tests, strict TypeScript, and build.
- The same installed extension and Comet X tab were reloaded with Japanese `lang="ja"` retained. Actual rows showed `2026/10/2 10:00 UTC-07:00 → 2026年10月3日（土）02:00 JST` and `2026/10/2 10:00 UTC-08:00 → 2026年10月3日（土）03:00 JST`, with the existing two-candidate uncertainty notice. The closed result was 152.5 px high at the current viewport; screenshot `/tmp/x-to-jst-source-comparison-20261002.jpg` was inspected. Broader client/theme/translation-mode coverage remains unchanged.

## 2026-10-02 candidate probabilities

- Candidate rows display the validated response's `probabilities[candidate.id]` as a percentage beside JST. The `unresolved` probability remains visible rather than renormalizing the time candidates to 100%. Locally unique results, absent keys, and API failure receive no invented probabilities. Confidence stays separate in details; thresholds, request state, and instructions are unchanged.
- Final `npm run check` passed with 119 tests, typecheck, and build. DOM checks use asymmetric candidate probabilities (12.3%, 7.7%) and separate 91% confidence/80% unresolved, checking correct candidate association and separation of quantities. High/low/unresolved cases exercise the displayed UI, including a candidate choice that remains unconfirmed by the extension's thresholds. Existing local/no-key cases assert no probability badge.
- The previous X tab had been closed. After updating the existing installation, the exact same public post URL was opened in a new tab of the same Comet client; its native Japanese translation (`lang="ja"`) was retained. The new validated reply had regional `02:00 JST = 56%`, literal `03:00 JST = 27%`, `unresolved = 17%`, and `confidence = 34%`. These are a fresh response, separate from the earlier 30% confidence observation. All three options total 100%; selection remains ambiguous. Screenshot `/tmp/x-to-jst-probabilities-20261002.jpg` was inspected and the result remained 152.5 px high. This measurement preceded the final neutral abstention-probability wording below.
- Official [confidence documentation](https://docs.typesafe.ai/confidence) describes confidence as distribution concentration, not the probability of one candidate. The adapter asks for the author's intended interpretation, sends the displayed text, posting timestamp, extracted expression, and computed candidates, and directs Jev to abstain without reliable evidence. It does not provide author-location evidence, an independent announcement, or a separately retrieved English original. Insufficient evidence to distinguish literal PST from colloquial Pacific time is a plausible explanation from this input/question, not a model-generated reason or a demonstrated causal ablation.
- Independent review identified that "Jev 判断保留" could falsely describe Jev's actual choice when only the extension's auto-selection threshold had blocked confirmation. The final source/build explicitly labels the distribution option as "Jev：選べない確率"; UI tests cover this distinction. Reloading that final wording in Comet is **pending**: the extension-management page became blank, its stale AX controls had no frame, and page reload/new-tab/direct-detail navigation/debugger stop did not restore its content. Candidate probability badges were verified on the preceding build, but the final wording is only build/test/review verified. The extra internal tab was closed and the user's original YouTube Studio tab was restored. Broader investigation of the management-page failure is outside this bounded change.


## Final display/evidence polish — 2026-10-02

- Scope: remove controls from posts with no parser-supported expression; explain seasonal/literal interpretations beside candidates; supply Jev with code-computed source zone, UTC offset, DST status and calculation notes. Existing probability badges, source/JST comparison, copying and auto-selection thresholds remain.
- `npm run check` passes: TypeScript, 125 tests across four files, and production build. Regression coverage includes control insertion/removal and article style restoration, current-body-only extraction through translation/recycled article changes, summer/winter labels, rebuilt seasonal evidence, and exclusion of unknown original-text fields from outgoing state.
- Independent review caught stale-original races in an intermediate English cache when body and identity updates arrived in either order. The cache and optional original-message path were removed entirely rather than relying on X update ordering. Final runtime sends only the current displayed text, not a previously observed body; no automatic language switching or original fetch was added. Jev accuracy/confidence improvement has not been established by an evaluation.
- Final build reload/live confirmation in the user's Comet is pending. Its extension detail page exposes stale accessibility controls but has a blank content surface; the reload control reports no frame. Earlier target-tab reload is not proof of the final build being installed. Further browser-management debugging is outside this change. The user's initial Discord tab was restored. Existing target-post observations in earlier sections establish the native translation behavior, not final-build UI validation.
