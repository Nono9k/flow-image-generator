export type RowStatus =
  | "pending"
  | "preparing"
  | "generating"
  | "success"
  | "failed"
  | "skipped"
  | "canceled";

export type BatchState = "idle" | "running" | "paused" | "stopped" | "complete" | "attention";

export interface DownloadSettings {
  subfolder: string;
  prefix: string;
  startingNumber: number;
  padding: number;
  outputsPerRow: number;
  concurrency: number;
}

export interface GeneratedImage {
  mediaId: string;
  sourceUrl: string;
  mimeType?: string;
}

export interface BatchQueueItem {
  row: number;
  prompt: string;
  ingredients: string[];
  validationErrors: string[];
}

export type DownloadStatus = "pending" | "success" | "failed";
export type SubmissionState = "not-submitted" | "submitted" | "stopped-after-submit";

export interface BatchRow {
  id: number;
  row: number;
  copy: number;
  index: number;
  prompt: string;
  ingredients: string[];
  status: RowStatus;
  error?: string;
  output?: GeneratedImage;
  downloadNumber: number;
  downloadFilename?: string;
  downloadStatus: DownloadStatus;
  downloadError?: string;
  claimId?: string;
  submissionState: SubmissionState;
  retries: number;
}
