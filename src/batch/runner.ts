import { submitOne, waitForClaimedResult, type TileClaim } from "../flow/generate-one";
import type { BatchQueueItem, BatchRow, BatchState, DownloadSettings, GeneratedImage, RowStatus } from "../types";

export interface BatchRunnerCallbacks {
  changed: () => void;
  download: (row: BatchRow, output: GeneratedImage, settings: DownloadSettings) => Promise<{ ok: true; filename: string } | { ok: false; error: string }>;
}

export class BatchRunner {
  readonly rows: BatchRow[] = [];
  state: BatchState = "idle";
  error = "";

  private active = false;
  private paused = false;
  private stopRequested = false;
  private disposed = false;
  private settings?: DownloadSettings;
  private readonly controllers = new Set<AbortController>();
  private readonly activeJobs = new Set<Promise<void>>();
  private submissionTail: Promise<void> = Promise.resolve();

  constructor(private readonly callbacks: BatchRunnerCallbacks) {}

  replaceQueue(items: readonly BatchQueueItem[], settings: DownloadSettings): void {
    if (this.active || this.disposed) return;
    this.rows.length = 0;
    let outputNumber = settings.startingNumber;
    items.forEach((item, rowIndex) => {
      for (let copy = 1; copy <= settings.outputsPerRow; copy += 1) {
        this.rows.push({
          id: this.rows.length + 1,
          row: item.row,
          copy,
          index: this.rows.length + 1,
          prompt: item.prompt,
          ingredients: item.ingredients,
          status: "pending",
          downloadNumber: outputNumber,
          downloadStatus: "pending",
          submissionState: "not-submitted",
          retries: 0,
        });
        outputNumber += 1;
      }
    });
    this.notify();
  }

  start(settings: DownloadSettings): void {
    if (this.disposed || this.active) return;
    this.settings = settings;
    this.error = "";
    this.paused = false;
    this.stopRequested = false;
    if (!this.rows.some((row) => row.status === "pending")) {
      this.state = "complete";
      this.notify();
      return;
    }
    this.active = true;
    this.state = "running";
    this.notify();
    void this.runLoop();
  }

  pause(): void {
    if (this.disposed || !this.active) return;
    this.paused = true;
    this.state = "paused";
    this.notify();
  }

  resume(): void {
    if (this.disposed || this.state !== "paused") return;
    this.paused = false;
    this.stopRequested = false;
    this.state = "running";
    if (!this.active && this.settings) {
      this.active = true;
      void this.runLoop();
    }
    this.notify();
  }

  stop(): void {
    if (this.disposed) return;
    this.stopRequested = true;
    this.paused = false;
    for (const row of this.rows) if (row.status === "pending") this.setRowStatus(row, "canceled");
    for (const controller of this.controllers) controller.abort();
    if (!this.active) this.state = "stopped";
    this.notify();
  }

  retryFailed(): void {
    if (this.disposed) return;
    for (const row of this.rows) {
      if (row.status !== "failed") continue;
      row.status = "pending";
      row.error = undefined;
      row.downloadStatus = "pending";
      row.downloadError = undefined;
      row.submissionState = "not-submitted";
      row.retries += 1;
    }
    if (this.rows.some((row) => row.status === "pending") && this.settings && !this.active) this.start(this.settings);
    this.notify();
  }

  async retryDownloads(): Promise<void> {
    const settings = this.settings;
    if (!settings || this.active || this.disposed) return;
    const rows = this.rows.filter((row) => row.status === "success" && row.downloadStatus === "failed" && row.output);
    await Promise.all(rows.map(async (row) => {
      row.downloadStatus = "pending";
      row.downloadError = undefined;
      this.notify();
      if (this.disposed) return;
      const result = await this.callbacks.download(row, row.output!, settings);
      if (this.disposed) return;
      if (result.ok) {
        row.downloadStatus = "success";
        row.downloadFilename = result.filename;
      } else {
        row.downloadStatus = "failed";
        row.downloadError = result.error;
      }
      this.notify();
    }));
  }

  dispose(): void {
    this.disposed = true;
    this.stopRequested = true;
    for (const controller of this.controllers) controller.abort();
  }

  private async runLoop(): Promise<void> {
    const settings = this.settings;
    if (!settings) return;
    try {
      while (!this.disposed) {
        while (!this.paused && !this.stopRequested && this.activeJobs.size < settings.concurrency) {
          const row = this.rows.find((candidate) => candidate.status === "pending");
          if (!row) break;
          const task = this.processRow(row, settings).finally(() => this.activeJobs.delete(task));
          this.activeJobs.add(task);
        }
        if (this.activeJobs.size) {
          await Promise.race([...this.activeJobs]);
          continue;
        }
        if (this.paused) {
          this.active = false;
          this.notify();
          return;
        }
        break;
      }
      if (this.disposed) return;
      if (this.stopRequested) this.state = "stopped";
      else if (this.rows.every((row) => ["success", "failed", "skipped", "canceled"].includes(row.status))) this.state = "complete";
      else this.state = "idle";
    } catch (error) {
      if (this.disposed) return;
      this.error = error instanceof Error ? error.message : String(error);
      this.state = "attention";
    } finally {
      this.active = false;
      this.notify();
    }
  }

  private async processRow(row: BatchRow, settings: DownloadSettings): Promise<void> {
    const controller = new AbortController();
    this.controllers.add(controller);
    let claim: TileClaim;
    let submitted = false;
    try {
      this.setRowStatus(row, "preparing");
      claim = await this.withSubmissionLock(async () => {
        await this.waitForSubmission(controller.signal);
        return submitOne({ id: String(row.id), prompt: row.prompt, ingredients: row.ingredients }, (phase) => {
          if (phase === "generating") this.setRowStatus(row, "generating");
        }, () => this.assertCanSubmit(), controller.signal, () => {
          if (this.disposed) return;
          submitted = true;
          row.submissionState = "submitted";
        });
      });
      if (this.disposed) {
        this.controllers.delete(controller);
        return;
      }
      row.claimId = claim.tileId;
    } catch (error) {
      if (!this.disposed) {
        if (submitted) {
          row.submissionState = "stopped-after-submit";
          this.setRowStatus(row, "canceled", "Generation was submitted to Flow and stopped; check Flow before retrying.");
        } else if (this.paused && !this.stopRequested) {
          row.submissionState = "not-submitted";
          this.setRowStatus(row, "pending");
        } else if (this.stopRequested) {
          this.setRowStatus(row, "canceled", error instanceof Error ? error.message : String(error));
        } else {
          this.setRowStatus(row, "failed", error instanceof Error ? error.message : String(error));
        }
      }
      this.controllers.delete(controller);
      return;
    }

    try {
      const output = await waitForClaimedResult(claim, controller.signal);
      if (this.disposed || controller.signal.aborted || this.stopRequested) {
        if (!this.disposed) {
          row.submissionState = "stopped-after-submit";
          this.setRowStatus(row, "canceled", "Generation was submitted to Flow and stopped; check Flow before retrying.");
        }
        return;
      }
      row.output = output;
      this.setRowStatus(row, "success");
      if (this.disposed || controller.signal.aborted || this.stopRequested) return;
      const download = await this.callbacks.download(row, output, settings);
      if (this.disposed) return;
      if (download.ok) {
        row.downloadFilename = download.filename;
        row.downloadStatus = "success";
      } else {
        row.downloadStatus = "failed";
        row.downloadError = download.error;
      }
      this.notify();
    } catch (error) {
      if (!this.disposed) {
        if (controller.signal.aborted || this.stopRequested) {
          row.submissionState = "stopped-after-submit";
          this.setRowStatus(row, "canceled", "Generation was submitted to Flow and stopped; check Flow before retrying.");
        } else {
          this.setRowStatus(row, "failed", error instanceof Error ? error.message : String(error));
        }
      }
    } finally {
      this.controllers.delete(controller);
    }
  }

  private withSubmissionLock<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.submissionTail;
    let release!: () => void;
    this.submissionTail = new Promise<void>((resolve) => { release = resolve; });
    return previous.then(task).finally(release);
  }

  private async waitForSubmission(signal: AbortSignal): Promise<void> {
    while (this.paused && !this.stopRequested && !this.disposed) {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = window.setTimeout(() => finish(resolve), 100);
        const abort = () => finish(() => reject(new Error("Batch stopped before submission.")));
        const finish = (action: () => void): void => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          signal.removeEventListener("abort", abort);
          action();
        };
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
    }
    this.assertCanSubmit();
  }

  private assertCanSubmit(): void {
    if (this.stopRequested || this.disposed) throw new Error("Batch stopped before submission.");
    if (this.paused) throw new Error("Batch paused before submission.");
  }

  private setRowStatus(row: BatchRow, status: RowStatus, error?: string): void {
    if (this.disposed) return;
    row.status = status;
    row.error = error;
    this.notify();
  }

  private notify(): void {
    if (!this.disposed) this.callbacks.changed();
  }
}
