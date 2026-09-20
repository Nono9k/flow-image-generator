const INGREDIENT_TIMEOUT_MS = 30_000;

export interface AssetScanResult {
  assets: string[];
  assetCounts: Record<string, number>;
  projectKey: string;
}

export async function scanProjectAssets(signal?: AbortSignal): Promise<AssetScanResult> {
  const picker = await openPicker(signal);
  try {
    const all = findTabOrOption("All", picker);
    all?.click();
    const search = await waitFor(
      () => findAssetSearch(picker) || findAssetSearch(),
      "Flow Search assets control was not found.",
      signal,
    );
    await setSearch(search, "", signal);
    const names = new Set<string>();
    const assetCounts = new Map<string, number>();
    const seenAssetIdentities = new Set<string>();
    let unchanged = 0;
    for (let page = 0; page < 200; page += 1) {
      const before = names.size;
      collectVisibleAssetEntries(picker).forEach(({ name, identity }) => {
        names.add(name);
        if (seenAssetIdentities.has(identity)) return;
        seenAssetIdentities.add(identity);
        const key = normalizeAssetName(name);
        assetCounts.set(key, (assetCounts.get(key) ?? 0) + 1);
      });
      const scroller = findAssetScroller(picker);
      if (!scroller) break;
      const previousTop = scroller.scrollTop;
      scroller.scrollTop = Math.min(
        scroller.scrollHeight - scroller.clientHeight,
        previousTop + Math.max(160, scroller.clientHeight * 0.8),
      );
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      await delay(250, signal);
      unchanged = names.size === before && scroller.scrollTop === previousTop ? unchanged + 1 : 0;
      if (unchanged >= 2) break;
    }
    return {
      assets: [...names].sort((a, b) => a.localeCompare(b)),
      assetCounts: Object.fromEntries(assetCounts),
      projectKey: `${location.origin}/project/${location.pathname.split("/")[2] ?? ""}`,
    };
  } finally {
    closePicker(picker);
  }
}

export async function attachIngredient(name: string, signal?: AbortSignal): Promise<void> {
  const composer = findComposer();
  const before = attachmentCount(composer);
  const picker = await openPicker(signal);
  try {
    const search = await waitFor(
      () => findAssetSearch(picker) || findAssetSearch(),
      "Flow Search assets control was not found.",
      signal,
    );
    await setSearch(search, name, signal);
    const option = await waitFor(
      () => findAssetOption(name, picker),
      `Flow asset "${name}" was not found in this project.`,
      signal,
    );
    option.click();
    await delay(350, signal);

    const pickerStillOpen = () => search.isConnected && isVisible(search);
    if (pickerStillOpen()) {
      const add = findButton("Add to prompt", picker) || findButton("Add to prompt");
      if (!add || add.disabled) throw new Error(`Flow selected "${name}" but did not offer Add to prompt.`);
      add.click();
    }

    await waitFor(
      () => !pickerStillOpen() && attachmentCount(findComposer()) > before ? true : undefined,
      `Flow did not attach ingredient "${name}".`,
      signal,
    );
  } finally {
    closePicker(picker);
  }
}

async function openPicker(signal?: AbortSignal): Promise<HTMLElement> {
  const button = await waitFor(
    () => findButton("Add ingredients to the prompt box"),
    "Flow ingredient control was not found.",
    signal,
  );
  button.click();
  return waitFor(
    () => {
      const search = findAssetSearch();
      const scope = search ? pickerScope(search) : undefined;
      return scope?.querySelector('[role="option"], [role="gridcell"]') ? scope : undefined;
    },
    "Flow asset picker did not open.",
    signal,
  );
}

function findAssetSearch(root: ParentNode = document): HTMLInputElement | undefined {
  return Array.from(root.querySelectorAll<HTMLInputElement>(
    'input[aria-label="Search assets"], input[placeholder="Search assets"], input[type="search"]',
  )).find(isVisible);
}

function findAssetOption(name: string, root: ParentNode): HTMLElement | undefined {
  const wanted = normalizeAssetName(name);
  return Array.from(root.querySelectorAll<HTMLElement>('[role="option"], [role="gridcell"], button'))
    .filter(isVisible)
    .find((option) => normalizeAssetName(option.textContent ?? "") === wanted);
}

function collectVisibleAssetEntries(root: ParentNode): Array<{ name: string; identity: string }> {
  const generic = /^(all|images?|videos?|voices?|characters?|avatars?|uploads?|recent|add to prompt|search assets|upload media|sort assets|image|video)$/i;
  const entries: Array<{ name: string; identity: string }> = [];
  for (const option of Array.from(root.querySelectorAll<HTMLElement>('[role="option"], [role="gridcell"]'))) {
    if (!isVisible(option)) continue;
    const values = [option.getAttribute("aria-label"), option.getAttribute("title"), option.textContent]
      .map((value) => value?.replace(/\s+/g, " ").trim() ?? "")
      .filter(Boolean);
    const name = values
      .map((value) => value.replace(/\s*Image$/i, "").trim())
      .find((value) => value.length < 180 && !generic.test(value) && !/[.…]$/.test(value));
    if (name) entries.push({ name, identity: assetIdentity(option, name) });
  }
  return entries;
}

function assetIdentity(option: HTMLElement, name: string): string {
  const mediaId = option.getAttribute("data-media-id") ?? option.querySelector<HTMLElement>("[data-media-id]")?.getAttribute("data-media-id");
  if (mediaId) return `media:${mediaId}`;
  const thumbnail = option.querySelector<HTMLImageElement>(".asset-thumbnail-image, img[src]");
  const source = thumbnail?.currentSrc || thumbnail?.src;
  return source ? `source:${source}` : `name:${normalizeAssetName(name)}`;
}

function findAssetScroller(root: ParentNode): HTMLElement | undefined {
  return [root, ...Array.from(root.querySelectorAll<HTMLElement>("div, ul, [role=listbox], [role=grid]"))]
    .filter((element): element is HTMLElement => element instanceof HTMLElement && element.scrollHeight > element.clientHeight + 20)
    .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
}

function pickerScope(search: HTMLInputElement): HTMLElement {
  let scope = search.parentElement;
  for (let depth = 0; depth < 9 && scope; depth += 1, scope = scope.parentElement) {
    if (scope.querySelector('[role="option"], [role="gridcell"]')) return scope;
  }
  return document.body;
}

function findTabOrOption(name: string, root: ParentNode): HTMLElement | undefined {
  const wanted = normalizeAssetName(name);
  return Array.from(root.querySelectorAll<HTMLElement>('[role="tab"], [role="option"], button'))
    .find((element) => isVisible(element) && normalizeAssetName(element.textContent ?? "") === wanted);
}

function findButton(name: string, root: ParentNode = document): HTMLButtonElement | undefined {
  const wanted = name.toLowerCase();
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => isVisible(button) && (button.getAttribute("aria-label") ?? button.textContent ?? "").trim().toLowerCase() === wanted);
}

function findComposer(): HTMLElement {
  const composer = document.querySelector<HTMLElement>(".base-prompt-box");
  if (!composer) throw new Error("Flow prompt composer was not found.");
  return composer;
}

function attachmentCount(composer: HTMLElement): number {
  return composer.querySelectorAll('button[aria-label="Ingredient"], img[alt^="Preview of "]').length;
}

async function setSearch(input: HTMLInputElement, value: string, signal?: AbortSignal): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: value, inputType: "insertText" }));
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  await delay(700, signal);
}

function closePicker(picker: HTMLElement): void {
  if (!picker.isConnected) return;
  const search = findAssetSearch(picker);
  if (!search || !isVisible(search)) return;
  search.focus();
  search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
}

export function normalizeAssetName(value: string): string {
  return value.replace(/\s*Image$/i, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function waitFor<T>(condition: () => T | undefined, message: string, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const root = document.body ?? document.documentElement;
    let settled = false;
    const observer = new MutationObserver(check);
    const timeout = window.setTimeout(() => finish(() => reject(new Error(message))), INGREDIENT_TIMEOUT_MS);
    const abort = () => finish(() => reject(new Error("Batch stopped before the Flow asset step completed.")));
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
    const abort = () => finish(() => reject(new Error("Batch stopped before the Flow asset step completed.")));
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

function isVisible(element: Element): boolean {
  if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") return false;
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = window.getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return element.getClientRects().length > 0;
}
