# Current Extension State

## Stack

- WXT 0.20.27
- TypeScript
- Manifest V3
- Plain TypeScript UI with a Shadow DOM panel
- Flow scope: `https://flow.google.com/*` (project behavior is gated to `/project/*`)

## What Works

- The WXT content script sets `data-flow-batch-extension="loaded"` in live Flow.
- The panel mounts on Flow project pages and is collapsible.
- The panel accepts one prompt per physical line and pairs optional comma-separated Flow asset names by line; blank prompt rows are rejected.
- Ingredient names are resolved case-insensitively against a scan of the current Flow project's asset picker.
- Image mode and x1 output are selected and verified before each job.
- Existing Flow assets are searched and attached one at a time, including multiple assets on the same row.
- Prompts use Flow's rich-text composer and verify Start generation enablement.
- New image cards are claimed using baseline wrapper/media/label exclusion plus the submitted prompt, not DOM position.
- Running, success, and failure states use the verified Flow percentage/result/error signals.
- Jobs fan out independently per requested output, serialize composer access, and monitor claimed Flow cards concurrently.
- Pause prevents new submissions while active monitors finish; Resume continues pending rows; Stop cancels pending work and aborts pre-submit preparation.
- Successful generated images download automatically through the background `downloads` handler using configurable prefix, assigned starting number, padding, and subfolder settings.
- Prompt JSON exports include the queue, download numbering, output filenames, and statuses.

## Architecture

- `entrypoints/content.ts`: Flow host bootstrap, marker, SPA route reconciliation, and panel lifecycle.
- `src/ui/panel.ts`: compact Shadow DOM batch panel, paired multiline inputs, download settings, and session UI state.
- `src/batch/runner.ts`: fan-out queue, composer mutex, concurrent claimed-card monitoring, pause/resume/stop state, row updates, and automatic output downloads.
- `src/flow/generate-one.ts`: image mode/output enforcement, prompt insertion, tile tracking, lifecycle detection, and output URL/MIME capture.
- `src/flow/ingredient.ts`: current-project asset scanning and verified Flow asset picker interaction.
- `src/download.ts`: filename/path sanitization and image extension selection.
- `entrypoints/background.ts`: one runtime message handler for Chrome downloads.

## Verification

- Live content marker and console bootstrap verified.
- Existing single-generation primitive completed a real Flow image generation.
- Prompt-only panel generation verified with a successful generated tile.
- Two existing Flow assets plus prompt generation verified with a successful card containing two Flow Ingredient controls.
- Two rows were previously verified sequentially; the current runner also verified two independent outputs from one row with concurrent monitoring.
- Pause/resume verified during a running generation.
- Export verified at `Documentaries/Episode-04/episode-04-image-prompts.json`.
- Multiline prompt parsing and strict physical-line validation verified.
- Comma-separated existing Flow asset names verified.
- Prompt-list download verified at `C:\Users\nono\Downloads\image-prompts.json`.
- Automatic generated-image download verified at `C:\Users\nono\Downloads\qa-07.jpg` with prefix `qa`, starting number `7`, and padding `2`.
- Asset-backed generation verified with two existing Flow assets attached to one generated card.
- Fan-out download numbering verified at `C:\Users\nono\Downloads\fanout-010.jpg` and `C:\Users\nono\Downloads\fanout-011.jpg`.

## Build

```text
npm run typecheck
npm run build
```

Both pass. Unpacked Chrome output:

`C:\Users\nono\Documents\Projects\Flow Extension\.output\chrome-mv3`

## Known Limitations

- Ingredient files are session-only and are not persisted across reloads.
- The queue is currently held in the content-script session; background durable queue claims and restart recovery are not yet implemented.
- Stop does not cancel a Flow generation already submitted; it only waits for that safe point.
- Flow UI selectors are based on the currently verified semantic controls and may change with Flow releases.
- A Flow rights/consent dialog for a newly uploaded image may still require the user to approve it once.
- The native file chooser can continue to announce `No file chosen`; the adjacent panel status shows the actual selected-file count.
- No automatic retries, durable recovery, video mode, or cloud sync.

## Deferred Features

- Durable background queue claims, restart recovery, automatic retries, video generation, start/end frames, selector self-healing, elaborate styling, cloud sync, and documentary pipeline integration.
