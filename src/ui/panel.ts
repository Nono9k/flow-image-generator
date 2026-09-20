import { BatchRunner } from "../batch/runner";
import { buildImageFilename } from "../download";
import { normalizeAssetName, scanProjectAssets } from "../flow/ingredient";
import type { BatchQueueItem, BatchRow, DownloadSettings, GeneratedImage } from "../types";
import { browser } from "wxt/browser";

const PANEL_ID = "flow-batch-extension-panel";
let panelInstance: BatchPanel | undefined;

export function mountBatchPanel(): void {
  if (!document.querySelector(".base-prompt-box") || document.getElementById(PANEL_ID)) return;
  panelInstance = new BatchPanel();
}

export function unmountBatchPanel(): void {
  panelInstance?.dispose();
  panelInstance = undefined;
  document.getElementById(PANEL_ID)?.remove();
}

class BatchPanel {
  private readonly host: HTMLDivElement;
  private readonly root: ShadowRoot;
  private readonly runner: BatchRunner;
  private collapsed = false;
  private promptText = "";
  private ingredientText = "";
  private assets: string[] = [];
  private assetCounts: Record<string, number> = {};
  private assetsScanned = false;
  private scanRunning = false;
  private scanController?: AbortController;
  private disposed = false;
  private inputError = "";
  private scanError = "";
  private subfolder = "";
  private prefix = "image";
  private startingNumber = 1;
  private padding = 4;
  private outputsPerRow = 1;
  private concurrency = 3;
  private draftDirty = false;

  constructor() {
    this.host = document.createElement("div");
    this.host.id = PANEL_ID;
    this.host.style.cssText = "position:fixed;top:76px;right:18px;z-index:2147483647;";
    this.root = this.host.attachShadow({ mode: "open" });
    this.runner = new BatchRunner({
      changed: () => this.render(),
      download: (row, output, settings) => this.downloadImage(row, output, settings),
    });
    document.documentElement.append(this.host);
    this.render();
  }

  private render(): void {
    if (this.disposed) return;
    const active = this.runner.state === "running" || this.runner.state === "paused";
    const preview = this.getPreview();
    const rows: QueueDisplayRow[] = this.runner.rows.length && !this.draftDirty
      ? this.runner.rows
      : preview.rows.flatMap((item) => Array.from({ length: this.outputsPerRow }, (_, copy) => ({
        row: item.row,
        copy: copy + 1,
        downloadNumber: this.startingNumber + (item.row - 1) * this.outputsPerRow + copy,
        status: "pending" as const,
        downloadStatus: "pending" as const,
      })));
    const settingsDisabled = active ? "disabled" : "";
    const startDisabled = active || this.scanRunning || !preview.valid || !preview.items.length;
    const hasBatch = this.runner.rows.length > 0 && !this.draftDirty;
    const success = hasBatch ? this.runner.rows.filter((row) => row.status === "success").length : 0;
    const failed = hasBatch ? this.runner.rows.filter((row) => row.status === "failed").length : 0;
    const downloadFailed = hasBatch ? this.runner.rows.filter((row) => row.downloadStatus === "failed").length : 0;
    const current = hasBatch ? this.runner.rows.find((row) => row.status === "preparing" || row.status === "generating") : undefined;

    this.root.innerHTML = `<style>${styles}</style>
      <section class="panel" aria-label="Flow image batch">
        <header class="header"><strong>FLOW IMAGE BATCH</strong><button class="collapse" type="button" aria-label="${this.collapsed ? "Expand" : "Collapse"} panel">${this.collapsed ? "+" : "-"}</button></header>
        <div class="body" ${this.collapsed ? "hidden" : ""}>
          <div class="state">Batch: <b>${this.runner.state}</b>${this.runner.error ? ` <span class="error">${escapeHtml(this.runner.error)}</span>` : ""}</div>
          ${this.inputError ? `<div class="error input-error">${escapeHtml(this.inputError)}</div>` : ""}
          ${this.scanError ? `<div class="error input-error">${escapeHtml(this.scanError)}</div>` : ""}
          <div id="draft-errors" class="error input-error" ${preview.errors.length ? "" : "hidden"}>${escapeHtml(preview.errors.join(" "))}</div>
          <div class="input-columns">
            <label>BLOCK 1 - IMAGE PROMPTS<textarea id="prompt-input" ${settingsDisabled} placeholder="One complete image prompt per physical line.">${escapeHtml(this.promptText)}</textarea></label>
            <label>BLOCK 2 - FLOW INGREDIENTS<textarea id="ingredient-input" ${settingsDisabled} placeholder="Exact asset filenames, comma-separated. Keep blank lines for rows without assets.">${escapeHtml(this.ingredientText)}</textarea></label>
          </div>
          <div class="asset-line"><button id="scan-assets" type="button" ${active || this.scanRunning ? "disabled" : ""}>${this.scanRunning ? "Scanning..." : "Scan Flow Assets"}</button><span>${this.assets.length ? `${this.assets.length} assets scanned` : "Scan the current project before using ingredients"}</span></div>
          <div class="stats"><span>Rows: <b>${preview.rows.length}</b></span><span>Outputs: <b>${preview.totalOutputs}</b></span><span>Current: <b>${current ? `${current.index} / ${this.runner.rows.length}` : `- / ${this.runner.rows.length || preview.totalOutputs}`}</b></span><span>Success: <b>${success}</b></span><span>Failed: <b>${failed}</b></span></div>
          <div class="actions"><button id="start-batch" type="button" ${startDisabled ? "disabled" : ""}>Start Batch</button><button id="pause-batch" type="button" ${this.runner.state !== "running" ? "disabled" : ""}>Pause</button><button id="resume-batch" type="button" ${this.runner.state !== "paused" ? "disabled" : ""}>Resume</button><button id="stop-batch" type="button" ${!active ? "disabled" : ""}>Stop</button><button id="retry-batch" type="button" ${failed === 0 || active ? "disabled" : ""}>Retry Failed</button><button id="retry-downloads" type="button" ${downloadFailed === 0 || active ? "disabled" : ""}>Retry Downloads</button></div>
          <div class="queue"><div class="queue-heading">QUEUE</div>${rows.map((row) => this.renderQueueRow(row)).join("") || `<div class="muted">Enter prompts to preview the queue.</div>`}</div>
          <fieldset class="downloads"><legend>BATCH SETTINGS</legend><label>Folder<input id="download-folder" value="${escapeAttribute(this.subfolder)}" placeholder="Documentaries/Episode-04" ${settingsDisabled} /></label><label>Filename prefix<input id="download-prefix" value="${escapeAttribute(this.prefix)}" ${settingsDisabled} /></label><div class="number-settings"><label>Starting number<input id="starting-number" type="number" min="1" value="${this.startingNumber}" ${settingsDisabled} /></label><label>Number padding<input id="number-padding" type="number" min="0" max="12" value="${this.padding}" ${settingsDisabled} /></label><label>Outputs per row<input id="outputs-per-row" type="number" min="1" max="20" value="${this.outputsPerRow}" ${settingsDisabled} /></label><label>Concurrency<input id="concurrency" type="number" min="1" max="6" value="${this.concurrency}" ${settingsDisabled} /></label></div><button id="download-prompts" type="button">Download Prompt List</button></fieldset>
        </div>
      </section>`;
    this.bindEvents();
  }

  private renderQueueRow(row: QueueDisplayRow): string {
    const icon = row.status === "success" ? "✓" : row.status === "failed" ? "!" : row.status === "generating" ? "●" : row.status === "canceled" ? "×" : "○";
    const download = row.downloadStatus === "success" ? ` <small>${escapeHtml(row.downloadFilename ?? "downloaded")}</small>` : row.downloadStatus === "failed" ? ` <small class="error">download failed</small>` : "";
    return `<div class="queue-row"><span class="job-index">${row.downloadNumber}</span><span class="job-status ${row.status}">${icon} ${row.status}</span><span class="job-meta">row ${row.row}, output ${row.copy}</span>${download}${row.error ? `<small class="error">${escapeHtml(row.error)}</small>` : ""}</div>`;
  }

  private getPreview(): ParsedBatch {
    return parseBatch(this.promptText, this.ingredientText, this.assets, this.assetCounts, this.assetsScanned, this.outputsPerRow);
  }

  private bindEvents(): void {
    this.root.querySelector<HTMLButtonElement>(".collapse")?.addEventListener("click", () => { this.collapsed = !this.collapsed; this.render(); });
    this.root.querySelector<HTMLButtonElement>("#start-batch")?.addEventListener("click", () => this.startBatch());
    this.root.querySelector<HTMLButtonElement>("#scan-assets")?.addEventListener("click", () => void this.scanAssets());
    this.root.querySelector<HTMLButtonElement>("#pause-batch")?.addEventListener("click", () => this.runner.pause());
    this.root.querySelector<HTMLButtonElement>("#resume-batch")?.addEventListener("click", () => this.runner.resume());
    this.root.querySelector<HTMLButtonElement>("#stop-batch")?.addEventListener("click", () => this.runner.stop());
    this.root.querySelector<HTMLButtonElement>("#retry-batch")?.addEventListener("click", () => this.runner.retryFailed());
    this.root.querySelector<HTMLButtonElement>("#retry-downloads")?.addEventListener("click", () => void this.runner.retryDownloads());
    this.root.querySelector<HTMLButtonElement>("#download-prompts")?.addEventListener("click", () => void this.downloadPrompts());
    this.root.querySelector<HTMLTextAreaElement>("#prompt-input")?.addEventListener("input", (event) => { this.promptText = (event.target as HTMLTextAreaElement).value; this.inputError = ""; this.draftDirty = true; this.refreshDraft(); });
    this.root.querySelector<HTMLTextAreaElement>("#ingredient-input")?.addEventListener("input", (event) => { this.ingredientText = (event.target as HTMLTextAreaElement).value; this.inputError = ""; this.draftDirty = true; this.refreshDraft(); });
    this.root.querySelector<HTMLInputElement>("#download-folder")?.addEventListener("input", (event) => { this.subfolder = (event.target as HTMLInputElement).value; });
    this.root.querySelector<HTMLInputElement>("#download-prefix")?.addEventListener("input", (event) => { this.prefix = (event.target as HTMLInputElement).value; });
    this.root.querySelector<HTMLInputElement>("#starting-number")?.addEventListener("input", (event) => { this.startingNumber = parseNumber((event.target as HTMLInputElement).value, 1); this.renderDraft(); });
    this.root.querySelector<HTMLInputElement>("#number-padding")?.addEventListener("input", (event) => { this.padding = parseNumber((event.target as HTMLInputElement).value, 4); this.renderDraft(); });
    this.root.querySelector<HTMLInputElement>("#outputs-per-row")?.addEventListener("input", (event) => { this.outputsPerRow = clamp(parseNumber((event.target as HTMLInputElement).value, 1), 1, 20); this.renderDraft(); });
    this.root.querySelector<HTMLInputElement>("#concurrency")?.addEventListener("input", (event) => { this.concurrency = clamp(parseNumber((event.target as HTMLInputElement).value, 3), 1, 6); });
  }

  private renderDraft(): void {
    const preview = this.getPreview();
    const jobs = this.root.querySelector<HTMLElement>(".stats span:nth-child(1) b");
    const outputs = this.root.querySelector<HTMLElement>(".stats span:nth-child(2) b");
    if (jobs) jobs.textContent = String(preview.rows.length);
    if (outputs) outputs.textContent = String(preview.totalOutputs);
    const queue = this.root.querySelector<HTMLElement>(".queue");
     if (queue) queue.innerHTML = `<div class="queue-heading">QUEUE</div>${preview.rows.flatMap((item) => Array.from({ length: this.outputsPerRow }, (_, copy) => ({ row: item.row, copy: copy + 1, downloadNumber: this.startingNumber + (item.row - 1) * this.outputsPerRow + copy, status: "pending" as const, downloadStatus: "pending" as const }))).map((row) => this.renderQueueRow(row)).join("") || `<div class="muted">Enter prompts to preview the queue.</div>`}`;
    const start = this.root.querySelector<HTMLButtonElement>("#start-batch");
    if (start) start.disabled = this.scanRunning || !preview.valid || !preview.items.length;
    const errors = this.root.querySelector<HTMLElement>("#draft-errors");
    if (errors) {
      errors.textContent = preview.errors.join(" ");
      errors.hidden = preview.errors.length === 0;
    }
  }

  private refreshDraft(): void {
    if (!this.promptText.trim() && !this.ingredientText.trim()) {
      this.render();
      return;
    }
    this.renderDraft();
  }

  private async scanAssets(): Promise<void> {
    if (this.disposed) return;
    const controller = new AbortController();
    this.scanController = controller;
    this.scanRunning = true;
    this.scanError = "";
    this.render();
    try {
      const result = await scanProjectAssets(controller.signal);
      if (this.disposed || controller.signal.aborted) return;
      this.assets = result.assets;
      this.assetCounts = result.assetCounts;
      this.assetsScanned = true;
      this.inputError = "";
    } catch (error) {
      if (this.disposed || controller.signal.aborted) return;
      this.scanError = error instanceof Error ? error.message : String(error);
    } finally {
      if (this.scanController === controller) this.scanController = undefined;
      if (!this.disposed) {
        this.scanRunning = false;
        this.render();
      }
    }
  }

  private startBatch(): void {
    const preview = this.getPreview();
    if (!preview.valid) { this.inputError = ""; this.render(); return; }
    const settings = this.getSettings();
    this.draftDirty = false;
    this.runner.replaceQueue(preview.items, settings);
    this.runner.start(settings);
  }

  private getSettings(): DownloadSettings {
    return { subfolder: this.subfolder, prefix: this.prefix, startingNumber: Math.max(1, Math.floor(this.startingNumber)), padding: clamp(Math.floor(this.padding), 0, 12), outputsPerRow: clamp(Math.floor(this.outputsPerRow), 1, 20), concurrency: clamp(Math.floor(this.concurrency), 1, 6) };
  }

  private async downloadImage(row: BatchRow, output: GeneratedImage, settings: DownloadSettings): Promise<{ ok: true; filename: string } | { ok: false; error: string }> {
    const filename = buildImageFilename(settings, row.downloadNumber, output.mimeType, output.sourceUrl);
    try {
      const response = await browser.runtime.sendMessage({ type: "flow-batch:download-image", url: output.sourceUrl, filename, subfolder: settings.subfolder });
      return response?.ok ? { ok: true, filename: response.filename ?? filename } : { ok: false, error: response?.error ?? "Image download failed." };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  }

  private async downloadPrompts(): Promise<void> {
    const settings = this.getSettings();
    const preview = this.getPreview();
     const rows = this.runner.rows.length && !this.draftDirty ? this.runner.rows : preview.items.flatMap((item) => Array.from({ length: settings.outputsPerRow }, (_, copy) => ({ row: item.row, copy: copy + 1, index: 0, prompt: item.prompt, ingredients: item.ingredients, downloadNumber: settings.startingNumber + (item.row - 1) * settings.outputsPerRow + copy, status: "pending", downloadStatus: "pending", submissionState: "not-submitted", retries: 0 })) as BatchRow[]);
    const payload = JSON.stringify({ settings, jobs: rows.map((row) => ({ row: row.row, copy: row.copy, assignedNumber: row.downloadNumber, prompt: row.prompt, ingredients: row.ingredients, status: row.status, filename: row.downloadFilename ?? buildImageFilename(settings, row.downloadNumber, row.output?.mimeType, row.output?.sourceUrl) })) }, null, 2);
    try {
      const response = await browser.runtime.sendMessage({ type: "flow-batch:download-prompts", filename: `${sanitizeForDisplay(settings.prefix) || "image"}-prompts.json`, subfolder: settings.subfolder, payload });
      if (!response?.ok) this.inputError = response?.error ?? "Prompt download failed.";
    } catch (error) { this.inputError = error instanceof Error ? error.message : String(error); }
    this.render();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scanController?.abort();
    this.scanController = undefined;
    this.runner.dispose();
  }
}

interface QueueDisplayRow { row: number; copy: number; downloadNumber: number; status: BatchRow["status"]; downloadStatus: BatchRow["downloadStatus"]; downloadFilename?: string; error?: string; }
interface ParsedBatch { items: BatchQueueItem[]; rows: Array<{ row: number; prompt: string; ingredients: string[]; validationErrors: string[] }>; errors: string[]; valid: boolean; totalOutputs: number; }

function parseBatch(promptText: string, ingredientText: string, assets: string[], assetCounts: Record<string, number>, assetsScanned: boolean, outputsPerRow: number): ParsedBatch {
  const prompts = trimTrailingBlankLines(lines(promptText));
  const ingredients = trimTrailingBlankLines(lines(ingredientText));
  const assetMap = new Map(assets.map((asset) => [normalizeAssetName(asset), asset]));
  const rows: ParsedBatch["rows"] = [];
  const items: BatchQueueItem[] = [];
  const errors: string[] = [];
  if (!prompts.length) errors.push("Add at least one prompt.");
  prompts.forEach((promptLine, index) => {
    const prompt = promptLine.trim();
    const validationErrors: string[] = [];
    if (!prompt) validationErrors.push(`Row ${index + 1} has no prompt.`);
    const ingredientLine = ingredients[index] ?? "";
    const rawIngredients = ingredientLine.trim() ? ingredientLine.split(",") : [];
    if (rawIngredients.some((value) => !value.trim())) validationErrors.push(`Row ${index + 1} has an empty comma-separated ingredient.`);
    const ingredientNames = rawIngredients.map((value) => value.trim()).filter(Boolean);
    if (ingredientNames.length && !assetsScanned) validationErrors.push("Scan this Flow project's assets before starting.");
    const resolved = ingredientNames.map((name) => assetMap.get(normalizeAssetName(name)) ?? name);
    ingredientNames.forEach((name) => {
      const key = normalizeAssetName(name);
      if (assetsScanned && !assetMap.has(key)) validationErrors.push(`Row ${index + 1}: asset "${name}" was not found in this Flow project.`);
      else if (assetsScanned && (assetCounts[key] ?? 0) > 1) validationErrors.push(`Row ${index + 1}: asset "${name}" is ambiguous because it appears more than once in Flow.`);
    });
    if (validationErrors.length) errors.push(...validationErrors);
    const row = { row: index + 1, prompt, ingredients: resolved, validationErrors };
    rows.push(row);
    items.push({ row: index + 1, prompt, ingredients: resolved, validationErrors });
  });
  ingredients.slice(prompts.length).forEach((line, index) => { if (line.trim()) errors.push(`Ingredient row ${prompts.length + index + 1} has no matching prompt.`); });
  return { items, rows, errors, valid: errors.length === 0 && items.length > 0, totalOutputs: items.length * clamp(outputsPerRow, 1, 20) };
}

function lines(value: string): string[] { return value.replace(/\r\n?/g, "\n").split("\n"); }
function trimTrailingBlankLines(value: string[]): string[] { const result = [...value]; while (result.length && !result[result.length - 1].trim()) result.pop(); return result; }
function parseNumber(value: string, fallback: number): number { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function sanitizeForDisplay(value: string): string { return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim().replace(/[. ]+$/, ""); }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character); }
function escapeAttribute(value: string): string { return escapeHtml(value); }

const styles = `
:host { all: initial; font-family: Arial, sans-serif; color: #202124; }
.panel { width: min(700px, calc(100vw - 28px)); max-height: calc(100vh - 96px); overflow: auto; background: #fff; border: 1px solid #c7c9cc; border-radius: 10px; box-shadow: 0 5px 22px #0003; font: 13px Arial, sans-serif; }
.header { display:flex; justify-content:space-between; align-items:center; padding:10px 13px; background:#f1f3f4; border-bottom:1px solid #dadce0; position:sticky; top:0; z-index:1; }
button { border:1px solid #b7bbc0; border-radius:5px; background:#fff; padding:6px 10px; cursor:pointer; font:inherit; } button:hover:not(:disabled){background:#f1f3f4} button:disabled{opacity:.45;cursor:default}
.collapse{padding:1px 8px;font-size:17px}.body{padding:10px}.state{margin-bottom:8px}.error{color:#b3261e}.input-error{margin-bottom:7px}
.input-columns{display:grid;grid-template-columns:1fr 1fr;gap:10px}label{display:grid;gap:4px;font-size:11px;color:#5f6368}textarea,input{box-sizing:border-box;width:100%;border:1px solid #bdc1c6;border-radius:5px;padding:8px;font:13px Arial,sans-serif;color:#202124}textarea{min-height:130px;resize:vertical;line-height:1.45}textarea:disabled,input:disabled{background:#f8f9fa}.asset-line{display:flex;align-items:center;gap:8px;padding-top:8px}.asset-line span,.muted,small{color:#5f6368;font-size:11px}
.stats{display:flex;flex-wrap:wrap;gap:13px;padding:9px 0 5px}.actions{display:flex;flex-wrap:wrap;gap:6px;margin:5px 0 10px}.queue{border-top:1px solid #dadce0;border-bottom:1px solid #dadce0;padding:7px 0;margin-bottom:10px}.queue-heading{font-weight:bold;font-size:11px;margin-bottom:4px}.queue-row{display:flex;gap:8px;align-items:center;padding:3px}.job-index{width:45px;text-align:right;color:#5f6368}.job-status.success{color:#137333}.job-status.failed{color:#b3261e}.job-status.generating,.job-status.preparing{color:#1967d2}.job-meta{color:#5f6368;font-size:11px}.downloads{border:1px solid #dadce0;border-radius:6px;display:grid;gap:7px}legend{color:#5f6368;font-size:11px;font-weight:bold}.number-settings{display:grid;grid-template-columns:1fr 1fr;gap:8px}
@media (max-width:600px){.input-columns{grid-template-columns:1fr}.panel{width:calc(100vw - 20px)}}
`;
