import { defineBackground } from "wxt/utils/define-background";
import { browser } from "wxt/browser";
import { buildDownloadPath } from "../src/download";

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (isImageDownloadMessage(message)) {
      return downloadUrl(message.url, message.filename, message.subfolder);
    }
    if (isPromptDownloadMessage(message)) {
      const filename = `${message.filename.replace(/\.json$/i, "")}.json`;
      const url = `data:application/json;charset=utf-8,${encodeURIComponent(message.payload)}`;
      return downloadUrl(url, filename, message.subfolder);
    }
    return undefined;
  });
});

function downloadUrl(
  url: string,
  filename: string,
  subfolder: string,
): Promise<{ ok: boolean; filename?: string; error?: string }> {
  try {
    if (new URL(url).protocol !== "https:" && !url.startsWith("data:")) {
      return Promise.resolve({ ok: false, error: "Only HTTPS or data URLs can be downloaded." });
    }
  } catch {
    return Promise.resolve({ ok: false, error: "Invalid download URL." });
  }
  const path = buildDownloadPath(filename, subfolder);
  return browser.downloads.download({
    url,
    filename: path,
    saveAs: false,
    conflictAction: "overwrite",
  }).then((downloadId) => waitForDownload(downloadId, path))
    .catch((error: unknown) => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
}

function waitForDownload(downloadId: number, filename: string): Promise<{ ok: boolean; filename?: string; error?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { ok: boolean; filename?: string; error?: string }): void => {
      if (settled) return;
      settled = true;
      browser.downloads.onChanged.removeListener(onChanged);
      resolve(result);
    };
    const onChanged = (delta: { id: number; state?: { current?: string }; error?: { current?: string } }): void => {
      if (delta.id !== downloadId) return;
      if (delta.error?.current) {
        finish({ ok: false, error: `Download interrupted: ${delta.error.current}` });
      } else if (delta.state?.current === "complete") {
        finish({ ok: true, filename });
      } else if (delta.state?.current === "interrupted") {
        finish({ ok: false, error: "Download interrupted." });
      }
    };
    browser.downloads.onChanged.addListener(onChanged);
    void browser.downloads.search({ id: downloadId }).then((items) => {
      const item = items[0];
      if (!item) {
        finish({ ok: false, error: "Chrome could not find the started download." });
      } else if (item.error) {
        finish({ ok: false, error: `Download interrupted: ${item.error}` });
      } else if (item.state === "complete") {
        finish({ ok: true, filename });
      } else if (item.state === "interrupted") {
        finish({ ok: false, error: "Download interrupted." });
      }
    }).catch((error: unknown) => finish({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  });
}

function isPromptDownloadMessage(message: unknown): message is {
  type: string;
  filename: string;
  subfolder: string;
  payload: string;
} {
  if (!message || typeof message !== "object") return false;
  const value = message as Record<string, unknown>;
  return value.type === "flow-batch:download-prompts" &&
    typeof value.filename === "string" &&
    typeof value.subfolder === "string" &&
    typeof value.payload === "string";
}

function isImageDownloadMessage(message: unknown): message is {
  type: string;
  url: string;
  filename: string;
  subfolder: string;
} {
  if (!message || typeof message !== "object") return false;
  const value = message as Record<string, unknown>;
  return value.type === "flow-batch:download-image" &&
    typeof value.url === "string" &&
    typeof value.filename === "string" &&
    typeof value.subfolder === "string";
}
