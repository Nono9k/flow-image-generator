import { attachIngredient } from "./ingredient";
import type { GeneratedImage } from "../types";

const FLOW_HOSTNAME = "flow.google.com";
const GENERATION_TIMEOUT_MS = 12 * 60 * 1000;
const CLAIM_TIMEOUT_MS = 45_000;
const PERCENTAGE_PATTERN = /^\d+%$/;

export interface GenerationJob {
  id: string;
  prompt: string;
  ingredients: string[];
}

export interface TileClaim {
  tile: HTMLElement;
  tileId: string;
  jobId: string;
  prompt: string;
  baselineMediaIds: Set<string>;
}

export async function submitOne(
  job: GenerationJob,
  onPhase?: (phase: "preparing" | "generating") => void,
  beforeSubmit?: () => void,
  signal?: AbortSignal,
  onSubmitted?: () => void,
): Promise<TileClaim> {
  verifySupportedFlowProject();
  throwIfAborted(signal);
  onPhase?.("preparing");
  const composer = await waitFor(findComposer, "Flow prompt composer was not found.", signal);
  await clearComposer(composer, signal);
  await ensureImageMode(signal);
  for (const ingredient of job.ingredients) await attachIngredient(ingredient, signal);

  const activeComposer = await waitFor(findComposer, "Flow prompt composer disappeared.", signal);
  const editor = findPromptEditor(activeComposer);
  insertPrompt(editor, job.prompt);
  const submit = findStartGeneration(activeComposer);
  await waitFor(
    () => submit.isConnected && !submit.disabled && !submit.hasAttribute("disabled") ? submit : undefined,
    "Start generation did not become enabled.",
    signal,
  );
  const baselineTiles = outputTiles();
  const baseline = {
    elements: new Set(baselineTiles),
    mediaIds: new Set(baselineTiles.map((tile) => tile.querySelector<HTMLImageElement>("img[data-media-id]")?.dataset.mediaId).filter((id): id is string => Boolean(id))),
    labels: new Set(baselineTiles.map((tile) => normalizeTileText(tile.getAttribute("aria-label") ?? ""))),
  };
  throwIfAborted(signal);
  beforeSubmit?.();
  onPhase?.("generating");
  submit.click();
  onSubmitted?.();
  const tile = await waitFor(
    () => findNewTile(baseline, job.prompt),
    "Flow did not create a new image tile within 45 seconds. Check Flow before retrying.",
    signal,
    CLAIM_TIMEOUT_MS,
  );
  const tileId = tile.getAttribute("data-media-id") || tile.id || `job:${job.id}`;
  tile.setAttribute("data-flow-batch-claim", job.id);
  return { tile, tileId, jobId: job.id, prompt: job.prompt, baselineMediaIds: baseline.mediaIds };
}

export async function waitForClaimedResult(
  claim: TileClaim,
  signal?: AbortSignal,
): Promise<GeneratedImage> {
  let candidate = "";
  let stable = 0;
  const started = Date.now();
  while (Date.now() - started < GENERATION_TIMEOUT_MS) {
    throwIfAborted(signal);
    if (!claim.tile.isConnected) {
      const replacement = findClaimedReplacement(claim);
      if (replacement) claim.tile = replacement;
      else {
        await delay(500, signal);
        continue;
      }
    }
    if (findVisiblePercentage(claim.tile)) {
      stable = 0;
      await delay(1000, signal);
      continue;
    }
    if (claim.tile.querySelector(".error-title, flow-error-tile")) {
      throw new Error(getTileError(claim.tile));
    }
    const image = claim.tile.querySelector<HTMLImageElement>("img[data-media-id]");
    const sourceUrl = image?.currentSrc || image?.src || "";
    if (image && sourceUrl) {
      const fingerprint = `${image.dataset.mediaId}:${sourceUrl}`;
      stable = fingerprint === candidate ? stable + 1 : 1;
      candidate = fingerprint;
      if (stable >= 3) {
        return {
          mediaId: image.dataset.mediaId ?? "",
          sourceUrl,
          mimeType: await readImageMimeType(sourceUrl, signal),
        };
      }
    }
    await delay(1000, signal);
  }
  throw new Error("Timed out waiting for Flow to finish. Check the claimed card before retrying.");
}

function verifySupportedFlowProject(): void {
  const url = new URL(window.location.href);
  if (url.hostname !== FLOW_HOSTNAME || !/^\/project\/[^/]+(?:\/|$)/.test(url.pathname)) {
    throw new Error("This is not a supported Google Flow project page.");
  }
}

async function ensureImageMode(signal?: AbortSignal): Promise<void> {
  let image = findVisibleRadio("Image");
  if (!image) {
    const settings = findVisibleButton("Settings trigger");
    if (!settings) throw new Error("Flow settings control was not found.");
    settings.click();
    image = await waitFor(() => findVisibleRadio("Image"), "Flow image/video controls did not open.", signal);
  }
  if (image.getAttribute("aria-checked") !== "true") {
    image.click();
    await waitFor(() => findVisibleRadio("Image")?.getAttribute("aria-checked") === "true" ? true : undefined, "Flow did not switch to image mode.", signal);
  }
  const x1 = await waitFor(() => findVisibleRadio("x1"), "Flow output-count controls were not found.", signal);
  if (x1.getAttribute("aria-checked") !== "true") {
    x1.click();
    await waitFor(() => findVisibleRadio("x1")?.getAttribute("aria-checked") === "true" ? true : undefined, "Flow did not switch to one output.", signal);
  }
}

async function clearComposer(composer: HTMLElement, signal?: AbortSignal): Promise<void> {
  const editor = findPromptEditor(composer);
  if (editor.textContent?.trim()) {
    editor.focus();
    document.execCommand("selectAll");
    document.execCommand("delete");
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
  }
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const remove = Array.from(composer.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      /remove|delete/i.test(button.getAttribute("aria-label") ?? button.textContent ?? "") && isVisible(button),
    );
    if (!remove) break;
    remove.click();
    await delay(250, signal);
  }
  await waitFor(
    () => {
      const current = findComposer();
      return !findPromptEditor(current).textContent?.trim() && attachmentCount(current) === 0 ? true : undefined;
    },
    "Flow did not clear the previous prompt and ingredients.",
    signal,
    5_000,
  );
}

function findComposer(): HTMLElement {
  const composer = document.querySelector<HTMLElement>(".base-prompt-box");
  if (!composer) throw new Error("Flow prompt composer was not found.");
  return composer;
}

function findPromptEditor(composer: HTMLElement): HTMLElement {
  const editor = composer.querySelector<HTMLElement>('[contenteditable="true"].ProseMirror, [contenteditable="true"]');
  if (!editor) throw new Error("Flow contenteditable prompt editor was not found.");
  return editor;
}

function attachmentCount(composer: HTMLElement): number {
  return composer.querySelectorAll('button[aria-label="Ingredient"], img[alt^="Preview of "]').length;
}

function findStartGeneration(composer: HTMLElement): HTMLButtonElement {
  const submit = composer.querySelector<HTMLButtonElement>('button[aria-label="Start generation"][type="submit"]');
  if (!submit) throw new Error("Flow Start generation button was not found.");
  return submit;
}

function insertPrompt(editor: HTMLElement, prompt: string): void {
  editor.focus();
  const selection = window.getSelection();
  if (!selection) throw new Error("Could not select the Flow prompt editor.");
  const range = document.createRange();
  range.selectNodeContents(editor);
  selection.removeAllRanges();
  selection.addRange(range);
  const inserted = document.execCommand("insertText", false, prompt);
  if (!inserted || editor.textContent !== prompt) {
    range.deleteContents();
    range.insertNode(document.createTextNode(prompt));
  }
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: prompt }));
  if (editor.textContent !== prompt) throw new Error("Flow did not accept the supplied prompt.");
}

function outputTiles(): HTMLElement[] {
  const wrappers = Array.from(document.querySelectorAll<HTMLElement>("flow-grid-tile-container"));
  if (wrappers.length) return wrappers;
  return Array.from(document.querySelectorAll<HTMLElement>("flow-image-tile"));
}

function findNewTile(
  baseline: { elements: Set<HTMLElement>; mediaIds: Set<string>; labels: Set<string> },
  prompt: string,
): HTMLElement | undefined {
  const candidates = outputTiles().filter((tile) => {
    if (tile.hasAttribute("data-flow-batch-claim")) return false;
    const mediaId = tile.querySelector<HTMLImageElement>("img[data-media-id]")?.dataset.mediaId;
    const label = normalizeTileText(tile.getAttribute("aria-label") ?? "");
    return !baseline.elements.has(tile) || (!!mediaId && !baseline.mediaIds.has(mediaId));
  });
  const wanted = normalizeTileText(prompt);
  const matching = candidates.filter((tile) => normalizeTileText(`${tile.getAttribute("aria-label") ?? ""} ${tile.textContent ?? ""}`).includes(wanted));
  return matching.length === 1 ? matching[0] : undefined;
}

function findClaimedReplacement(claim: TileClaim): HTMLElement | undefined {
  const wanted = normalizeTileText(claim.prompt);
  const claimed = outputTiles().filter((tile) => tile.getAttribute("data-flow-batch-claim") === claim.jobId);
  const candidates = claimed.length ? claimed : outputTiles().filter((tile) => {
    const mediaId = tile.querySelector<HTMLImageElement>("img[data-media-id]")?.dataset.mediaId;
    return !mediaId || !claim.baselineMediaIds.has(mediaId);
  });
  const matching = candidates.filter((tile) => normalizeTileText(`${tile.getAttribute("aria-label") ?? ""} ${tile.textContent ?? ""}`).includes(wanted));
  const replacement = matching.length === 1 ? matching[0] : undefined;
  replacement?.setAttribute("data-flow-batch-claim", claim.jobId);
  return replacement;
}

function normalizeTileText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function findVisiblePercentage(tile: HTMLElement): string | undefined {
  return [tile, ...Array.from(tile.querySelectorAll("*"))].find((element) =>
    isVisible(element) && PERCENTAGE_PATTERN.test((element.textContent ?? "").trim()),
  )?.textContent?.trim();
}

function getTileError(tile: HTMLElement): string {
  return tile.querySelector(".error-title")?.textContent?.trim() || "Flow image generation failed.";
}

function findVisibleButton(name: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
    (button.getAttribute("aria-label") ?? button.textContent ?? "").trim() === name && isVisible(button),
  );
}

function findVisibleRadio(name: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="radio"]')).find((radio) => {
    const label = (radio.getAttribute("aria-label") ?? radio.textContent ?? "").trim().toLowerCase();
    return (label === name.toLowerCase() || label.endsWith(name.toLowerCase())) && isVisible(radio);
  });
}

async function readImageMimeType(sourceUrl: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const response = await fetch(sourceUrl, { method: "HEAD", signal });
    return response.headers.get("content-type")?.split(";", 1)[0] || undefined;
  } catch {
    return undefined;
  }
}

function waitFor<T>(condition: () => T | undefined, message: string, signal?: AbortSignal, timeoutMs = GENERATION_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const root = document.body ?? document.documentElement;
    let settled = false;
    const observer = new MutationObserver(check);
    const timeout = window.setTimeout(() => finish(() => reject(new Error(message))), timeoutMs);
    const abort = () => finish(() => reject(new Error("Batch stopped before this Flow step completed.")));
    function finish(action: () => void): void {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      observer.disconnect();
      signal?.removeEventListener("abort", abort);
      action();
    }
    function check(): void {
      if (settled) return;
      try {
        const value = condition();
        if (value !== undefined) finish(() => resolve(value));
      } catch (error) {
        finish(() => reject(error));
      }
    }
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    check();
  });
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => finish(resolve), milliseconds);
    const abort = () => finish(() => reject(new Error("Batch stopped before this Flow step completed.")));
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      action();
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Batch stopped before this Flow step completed.");
}

function isVisible(element: Element): boolean {
  if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") return false;
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = window.getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return element.getClientRects().length > 0;
}
