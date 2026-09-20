# Reference extension overview

The reference is the unpacked Chrome extension under `Refrences/fnmijgmnjpealnnadjpjilaanhhambeb/3.4.4.0_0`, version 3.4.4. This audit is primarily source-based; Chrome exposed the Flow page but no reference extension page/side-panel was available for an independent live run.

## Features

- MV3 side-panel automation for text-to-video, image-to-video, components-to-video, text-to-image, image-to-image, and agent modes.
- Blank-line batch prompts, output counts, concurrent groups, random delays, previous-frame chaining, character/speaker matching, image/spreadsheet import, and automatic downloads.
- Project creation/navigation, mode configuration, upload/asset selection, generation monitoring, cancellation, progress, retries, and download naming.

## File/architecture map

- `manifest.json`: content script `assets/index.ts-loader-CBrD-M0v.js` at document end on `*://flow.google.com/*`; module worker `service-worker-loader.js`; side panel `src/ui/side-panel/index.html`; permissions include storage, tabs, background, sidePanel, activeTab, downloads, and debugger.
- The loader imports `assets/index.ts-DFAayvhs.js`, the main content/injected automation. It creates projects, configures modes, fills prompts, uploads/selects assets, submits, waits for tiles, downloads results, and reports logs/progress.
- `assets/catchUploadFile.ts-DJwIizxX.js` is a web-accessible upload bridge. It intercepts `HTMLInputElement.prototype.click`, remembers a Flow file input while `html[data-veo-active="true"]` is set, then handles `VEO_UPLOAD_FILE_DATA` by making a `File`, assigning it through `DataTransfer`, and dispatching `change`.
- `assets/index.ts-B2QzyOff.js` plus the worker is a background message router for tabs, downloads, prompt-group state/cancellation, chunked image data, and optional CDP input through `chrome.debugger`.
- `assets/index.html-YcmfxOFZ.js`/CSS are a compiled Vue/PrimeVue side panel. `remoteConfig-BX4Oz3mk.js` supplies runtime/localized configuration; `utils-BCNko0UU.js` supplies a jQuery-like query/event/wait layer and media helpers.
- Exact Flow selectors are partly runtime/remote configured; the package has no complete readable selector inventory.

## Flow interaction strategy

The main code uses a configured selector map (`configButton`, mode options, aspect-ratio/output-count/model templates, `promptTextarea`, `submitButton`, upload controls, tile selectors, and download controls), then generic query/click helpers with logging and polling. It explicitly expects `div[role='textbox']` in one prompt path and uses generated/template CSS and jQuery-style `:eq(0)` for asset selection.

Our verified map is better: use role plus accessible name for controls, `.base-prompt-box [contenteditable="true"]` for the composer, and scoped open menus/radio groups. The reference adds no better locator for Start generation, the upload input, model menu, radios, or tracked tiles. Its generic config selectors, generated classes, first-match selection, and `:eq(0)` are fragile. Important configured names include `promptTextarea`, `configButton`, `selectVideoMode`, `aspectRatioTemplate`, `outputCountTemplate`, `modelSelectButton`/`modelTemplate`, `videoLengthTemplate`, `uploadMediaButton`, `searchUploadedImage`, `firstFoundedItemSelector`, `submitButton`, `outputItems`, `stopButton`, and `downloadDoneButton`; their exact runtime values are not statically verifiable.

## Batch/queue implementation

Blank-line prompts become prompt groups sent as `AUTO_FILL_FLOW` with payloads, group ID, concurrency, and min/max delay. The worker keeps groups in an in-memory queue, handles `PROMPT_GROUP_STATUS` and `CANCEL_PROMPT_GROUP`, and reports queued/completed/error/retrying states. UI supports 1–6 concurrent prompts.

This is more capable than v1 but worker restart can lose in-memory state. Keep the useful status model without concurrency, chaining, or remote features initially.

## Prompt handling

Mode-specific forms fill the configured textbox and click the configured submit control. The code can inject an extracted previous frame and select character/speaker assets from prompt text. It uses fixed waits (often 1,000 ms) after filling and sometimes randomly chooses normal click versus lower-level input.

Our live evidence is stronger: non-empty composer text enables `button[aria-label="Start generation"]`, empty text disables it. The reference provides no better submit locator or state signal.

## Upload handling

The reference avoids the native chooser with the `VEO_UPLOAD_FILE_DATA` bridge: base64 becomes a Blob/File, `DataTransfer` supplies `input.files`, and bubbling `change` is dispatched. Main code chooses upload type, sorts latest, searches, selects the first match, and waits for upload.

Useful if chooser automation is impossible, but it depends on prototype monkey-patching, a page flag, a custom event, and one remembered input; errors are swallowed. Our map verifies that Flow creates a hidden body-level `input[type=file][multiple]` only after role `button[name="Upload media"]` is clicked, so observe insertion instead of assuming startup input. Successful upload and input reuse/removal remain unverified.

## Generation lifecycle detection

The reference waits for configured output items/tiles, filters error tiles, derives tile/resource IDs, and emits `VIDEO_GENERATION_PROGRESS` with group, prompt index, percentage, status, and prompt. It has `waitForTileIds` and `waitForResourcesInTiles` polling, recognizes a `stopButton`, and uses a long 900,000 ms wait budget. One path looks for a `_flow_tile_` marker.

The verified current Flow contract is safer: retain the newly created `flow-image-tile` containing the submitted prompt; `/^\d+%$/` means running; success is no percentage plus `img[data-media-id]` and no `.error-title`; failure is `.error-title`/`flow-error-tile`. The tile may be prepended at index 0, so do not copy index/`:eq(0)` tracking. No cancel control was observed.

## Error/retry behavior

The code returns structured step errors, filters error tiles, has `maxRetries` (default 1 in the UI bundle), retries downloads, and reports timeout/cancel/failure. It does not clearly implement the native Flow Retry button; it mainly retries automation/download steps.

The live map gives the concrete terminal failure: `.error-title` is `Failed`, with policy/no-charge text and tile-scoped `Retry`, `Reuse prompt`, and `Delete`. A v1 runner should classify this state rather than blindly retry.

## Persistence

Settings use `chrome.storage.local`, including visible `flow_automation_settings`, `daily-prompt-count`, and `daily-prompt-date` keys. Uploaded image records contain base64 and metadata. Prompt groups/execution are primarily in-memory worker state, not demonstrated as durable queue storage. Remote account/plan, update, and licensing flows are also present.

For v1, persist only settings and a small checkpoint if restart recovery is required; avoid base64-heavy libraries and account services.

## Navigation handling

The content code checks `window.location.href.includes('/project/')`, skips project creation when already in a project, can return to the main project page, queries Flow tabs, and provides a “Go to Flow” side-panel path. Content injection is limited to Flow pages at document end.

This is defensive but substring URL testing and retained-page assumptions are brittle. Re-resolve DOM controls after navigation.

## Useful ideas worth adopting

- Semantic progress messages keyed by group and prompt index.
- Retain the newly created tile element rather than relying on index/order.
- Bounded cancellable observation with explicit terminal predicates.
- Separate settings from transient execution and expose cancellation/error states.
- Use a tightly scoped DataTransfer bridge only if native chooser handling is impossible.
- Preserve prompt-to-result association in every progress event.

## Fragile or overengineered parts to avoid

- Large compiled multi-mode and remote-configured automation for a small first release.
- jQuery-like abstraction, generated CSS/templates, `:eq(0)`, generic classes, and first-match asset selection.
- Fixed 300 ms/500 ms/1 s/2 s/5 s sleeps where DOM state is observable, plus an opaque 900 s budget.
- Prototype monkey-patching/custom flags/events without guaranteed cleanup; swallowed upload errors.
- `debugger` permission and synthetic CDP mouse/keyboard input for normal controls.
- In-memory worker queue, base64 asset persistence, quota/account APIs, and six-way concurrency for v1.
- Random click/input paths and synthetic 100% as proof of successful Flow completion.

## New Flow knowledge discovered

- The reference confirms a technique for remembering the file input at click time and supplying it via DataTransfer, but adds no verified evidence that Flow accepts the file or removes the input.
- A source string mentions a tile marker containing `_flow_tile_`; exact element/attribute and current applicability are unverified and weaker than the observed `flow-image-tile`/`img[data-media-id]` map.
- The explicit prompt strategy expects `div[role='textbox']`, consistent with but less precise than verified `.base-prompt-box [contenteditable="true"]`.
- `/project/` URL handling is a source assumption, not new live control/lifecycle evidence.
- No stable data hook, request ID, cancel control, or better completion selector was found. Exact remote selector values and a successful reference generation could not be independently verified in the available profile.

## Comparison with our planned v1

The current simple sequential v1 architecture should remain. Adopt semantic queue/progress records, retained same-tile tracking, bounded cancellable observation, and explicit failure classification. Keep one prompt at a time, role/name locators, dynamic upload-input observation, and verified percentage/result/error predicates. Defer concurrency, project creation, extra modes, automatic downloads, character/speaker matching, remote licensing/configuration, debugger permission, and durable base64 asset libraries until required.
