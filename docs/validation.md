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
