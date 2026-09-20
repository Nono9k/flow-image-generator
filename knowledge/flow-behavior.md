# Google Flow reconnaissance continuation

## Newly verified controls
- Pre-submit validation was directly rechecked without submission: `button[aria-label="Start generation"]` is a submit button with accessible name Start generation and icon-only visible text `arrow_forward`. It is disabled with an empty composer and nearby description `Prompt must be provided`; typing a temporary harmless prompt clears the disabled property/attribute, and clearing the prompt restores disabled. Preferred locator is role plus name scoped to the composer; do not use numeric UIDs.
- The image model menu currently exposes exactly these live `role=menuitem` labels: Nano Banana Pro, Nano Banana 2, and Nano Banana 2 Lite. The video menu was previously observed with Omni 1.1 Flash and Veo 3.1 - Lite/Fast/Quality. Scope menuitems to the open `role=menu` and identify by accessible/visible label; menu IDs and accessibility UIDs are runtime-only.
- Upload lifecycle is now verified: no `input[type=file]` exists before opening the asset picker or immediately after opening it. Clicking the live Upload media button inserts one body-level hidden file input: `type=file`, `multiple`, `accept=".png,.jpg,.jpeg,.webp,.gif,.heif,.heic,.mp4,.m4v,.mov,.3gp,.avi"`. Wait for insertion after activation with a DOM observer/poll; do not assume a startup input. Removal/reuse after chooser cancellation or completion remains unknown.

- Add ingredients opens an asset picker with tabs All, Images, Videos, Voices, Characters, Avatars, Uploads; Upload media; Search assets; Sort assets (Recent); Asset list; and Add to prompt when selected. See `flow-ui-map.json` controls `asset_upload`, `asset_picker_add`.
- Settings exposes Image/Video. Video adds Video type: Frames (checked) and Ingredients. Image ratios: 16:9, 4:3, 1:1, 3:4, 9:16; video: 16:9 and 9:16.
- Select model family opened Omni 1.1 Flash, Veo 3.1 - Lite/Fast/Quality. Output count is x1-x4. Current model varied: Nano Banana 2 image, Veo 3.1 - Lite video.
- Start generation is a submit button: disabled empty with description Prompt must be provided; earlier populated snapshot enabled. No separate Generate/Create control found.

## Newly verified state evidence

Existing image asset opened `/edit/<id>` and showed Tile displaying a user's image plus editor actions. This verifies an existing completed asset presentation only, not a newly submitted job.

## Still unverified

Native file input/chooser, successful start-frame upload, and model child choices remain unverified.

## Fragile selectors and behavior

No data-* hooks were exposed; numeric accessibility UIDs are session-specific. Settings trigger is generic (`aria-label="Settings trigger"`) and lives in the composer `submit-controls`/`base-prompt-box`; scope it to that composer rather than using a UID. Radio `name` values repeat only as implementation-generated group names and IDs are runtime-only; scope radios to their surrounding settings group/radiogroup and identify by label (e.g. 16:9), never by name or numeric ID alone. Model menuitems must be scoped to the currently open menu. Upload's sidebar-upload-btn has no data hook and the file input is dynamically inserted only after Upload media activation. Start generation should be found by role/name, then verified by its disabled state and nearby validation description.

## Verified generation lifecycle (one submission only)

One harmless submission used `A small blue circle on a white background`. Before submit, the contenteditable inside `.base-prompt-box` contained that text and the Start generation submit button was enabled; six existing images and no new job tile were present.

Immediately after submit, the editor cleared, Start generation remained but became disabled, and a new sibling job tile appeared. Accessibility exposed `0%` and the exact prompt. No cancel or retry control was exposed.

The tile progressed through `0%`, `53%`, and `80%`. Identify it as the newly appended `flow-image-tile` containing an element matching `/^\d+%$/`; it is running while that percentage exists. Wait for insertion or text mutation, not a fixed delay. No cancel appeared.

The run reached terminal failure without an intentional failure attempt: `flow-image-tile > .container > flow-error-tile > .error-tile`; `.error-title` was `Failed`, the message was `This generation might violate our policies. Please try a different prompt or send feedback.`, and `.disclaimer-message` was `You have not been charged for this generation.` The percentage disappeared. Tile scoped buttons were `Retry`, `Reuse prompt`, and `Delete`. Successful result controls were not observed.

Correlation is reliable for this isolated run by recording tile count and order plus prompt, selecting the newly appended `flow-image-tile` containing the exact prompt, and retaining that parent through transitions. No stable data hook or request ID was exposed before success; identical concurrent prompts remain unverified.

Wait signals: new tracked tile plus disabled submit; percentage insertion or mutation while running; percentage removal plus `.error-title` or result media in the same tile at terminal state. Do not use fixed sleeps when these DOM signals exist.


## Successful completion verification (one additional submission)
- Before submit, live DOM had exactly one `flow-image-tile`, in order `flow-image-tile > img[data-media-id="360ab36e-804d-4e2d-b8c9-f0d66e9f850a"]`. Composer was `.base-prompt-box [contenteditable="true"]` (`class="ProseMirror"`) containing `A single red apple on a white background`; `button[aria-label="Start generation"]` (`type="submit"`) was enabled.
- Exactly one image generation was submitted. Immediately afterward a second `flow-image-tile` appeared at DOM index 0 (the view prepended it in this observation), exposed accessible StaticText `0%` and the exact prompt; the composer cleared and Start generation became disabled.
- Running was verified by the same tile containing visible percentage text matching `/^\d+%$/`; `0%` was observed. The percentage later disappeared on that same retained element.
- Successful terminal DOM: the retained `flow-image-tile` contained `img.image[data-media-id="408cdfbd-0c10-4635-9dc0-f0a02a94ce9c"]` with implicit role `image`, accessible name from `alt="Tile displaying a user's image"`, `draggable="false"`, and `style="aspect-ratio: 1.77778 / 1;"`. Custom components were `flow-image-tile`, `flow-image-hotbar`, `flow-hotbar-container`, and `flow-tile-hover-footer`; result buttons had `aria-label` Favorite, Reuse prompt, and More options (the latter `aria-haspopup="menu"`, `aria-expanded="false"`). The footer exposed `.footer-title` text `Red apple on white background`, and batch metadata exposed the exact submitted prompt. No `.error-title` or terminal error content existed.
- Strongest verified SUCCESS condition: same tracked tile has no visible descendant matching `/^\d+%$/` AND contains `img[data-media-id]` result media AND has no `.error-title`. No explicit Success/Completed text was exposed; pixels/screenshots are unnecessary.
- This verifies same-element tracking from submission through completion for an isolated run. DOM insertion order is not guaranteed to be append-at-end (it was index 0 here); retain the newly created element, not only an index. No request ID/data hook was exposed before result; identical concurrent prompts remain untested.

