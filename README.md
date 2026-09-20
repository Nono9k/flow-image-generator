# Flow Image Generator

Flow Image Generator is a Chrome extension that adds a batch-generation panel to [Google Flow](https://flow.google.com/). It turns a list of prompts into independent image-generation jobs and can attach existing assets from the current Flow project to each prompt.

The extension is intended for users who need repeatable, asset-backed image generation without submitting every prompt manually.

## Features

- Run one prompt per physical input line.
- Pair each prompt with optional comma-separated Flow asset names.
- Scan the current project and resolve asset names case-insensitively.
- Validate missing, ambiguous, and unknown assets before starting.
- Use image mode and verify Flow's generation controls before each job.
- Run multiple outputs per prompt with configurable concurrency.
- Track preparing, generating, successful, failed, and canceled jobs.
- Pause new submissions, resume pending work, stop pending work, and retry failures.
- Download generated images automatically with configurable folder, prefix, starting number, and zero padding.
- Export the prompt queue, settings, assigned numbers, filenames, and statuses as JSON.
- Reconcile correctly when Flow navigates between projects without a full page reload.

## Requirements

- Google Chrome or another Chromium-based browser with support for unpacked extensions.
- A Google account with access to [Google Flow](https://flow.google.com/).
- Node.js and npm for building from source.

## Install From Source

1. Clone the repository and install dependencies:

   ```bash
   npm install
   ```

2. Build the extension:

   ```bash
   npm run build
   ```

3. Open `chrome://extensions` in Chrome.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the generated `.output\chrome-mv3` directory.
7. Open a Google Flow project at `https://flow.google.com/project/...` and reload the page if necessary.

The panel appears near the upper-right corner of the Flow prompt composer. It only mounts on Flow project pages.

## Usage

### Run a batch

1. Enter one complete image prompt per line in **Block 1 - Image Prompts**.
2. Optionally enter one matching ingredient line per prompt in **Block 2 - Flow Ingredients**.
3. Separate multiple asset names with commas. Leave a line blank when that prompt has no ingredients.
4. Click **Scan Flow Assets** before using ingredients.
5. Configure output count, concurrency, and download naming under **Batch Settings**.
6. Click **Start Batch**.

For example, the prompt field contains:

```text
Wide establishing shot of a rainy neon market at night
Close-up portrait of the traveler beneath a red umbrella
```

The ingredient field contains the matching lines:

```text

traveler-reference.png, market-reference.png
```

The first prompt has no ingredients. The second prompt uses two assets from the current Flow project. Prompt and ingredient lines are matched by their physical line number.

### Controls

- **Pause** prevents new jobs from being submitted while active generations finish.
- **Resume** continues pending jobs.
- **Stop** cancels pending work. A generation already submitted to Flow is not canceled.
- **Retry Failed** retries failed generation jobs.
- **Retry Downloads** retries image downloads that failed after generation.
- **Download Prompt List** exports the current queue as JSON.

## Development

Start the WXT development server:

```bash
npm run dev
```

Run the type checker:

```bash
npm run typecheck
```

Create a production build:

```bash
npm run build
```

The project uses:

- TypeScript
- WXT
- Manifest V3
- A plain TypeScript UI rendered inside a Shadow DOM panel

## Project Structure

```text
entrypoints/content.ts       Flow host bootstrap and panel lifecycle
entrypoints/background.ts    Chrome download message handler
src/ui/panel.ts              Panel UI, input parsing, and session state
src/batch/runner.ts          Queue execution and job monitoring
src/flow/generate-one.ts     Flow controls and generation lifecycle
src/flow/ingredient.ts       Project asset scanning and attachment
src/download.ts              Filename and download path handling
src/types.ts                 Shared queue and result types
docs/current-status.md       Detailed implementation status and verification notes
knowledge/                   Flow behavior and UI research snapshots
```

## Permissions and Data Handling

The extension requests the Chrome `downloads` permission so it can save generated images and prompt-list JSON files. The content script runs on `https://flow.google.com/*` and activates its panel only for `/project/*` pages.

There is no backend service or cloud sync. Prompts, queue state, and ingredient selections remain in the current content-script session. Generated images are downloaded directly through the browser's download API.

## Current Limitations

- Ingredient files are session-only and are not persisted across reloads.
- Queue state is not durable across extension or page restarts.
- Stopping a job cannot cancel a generation already submitted to Flow.
- Flow selectors depend on the current Flow UI and may need updates when Flow changes.
- A newly uploaded image may require a one-time Flow rights or consent approval.
- Automatic retries, video generation, start/end frames, and cloud sync are not implemented.

## License

No license has been added yet. All rights are reserved unless a license is added to this repository.
