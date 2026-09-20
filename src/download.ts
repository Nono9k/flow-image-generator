import type { DownloadSettings } from "./types";

export function buildImageFilename(
  settings: DownloadSettings,
  assignedNumber: number,
  mimeType?: string,
  sourceUrl?: string,
): string {
  const prefix = sanitizePart(settings.prefix) || "image";
  const padding = Math.max(0, Math.min(12, Math.floor(settings.padding)));
  return `${prefix}-${String(assignedNumber).padStart(padding, "0")}.${getImageExtension(mimeType, sourceUrl)}`;
}

export function buildDownloadPath(filename: string, subfolder: string): string {
  const safeFilename = sanitizePart(filename) || "download";
  const safeFolder = subfolder.split(/[\\/]+/).map(sanitizePart).filter(Boolean);
  return [...safeFolder, safeFilename].join("/");
}

export function getImageExtension(mimeType?: string, sourceUrl?: string): string {
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "image/heic": "heic",
  };
  if (mimeType && extensions[mimeType.toLowerCase()]) return extensions[mimeType.toLowerCase()];
  try {
    const extension = new URL(sourceUrl ?? "").pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    if (extension && ["jpg", "jpeg", "png", "webp", "gif", "avif", "heic"].includes(extension)) {
      return extension === "jpeg" ? "jpg" : extension;
    }
  } catch {
    // Flow's signed image URLs are normally extensionless.
  }
  return "jpg";
}

export function sanitizePart(value: string): string {
  const part = value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim().replace(/[. ]+$/, "");
  if (!part || /^\.+$/.test(part)) return "";
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(part)) return `_${part}`;
  return part;
}
