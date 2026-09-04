import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";

export type OpenedPdfFile = {
  path: string | null;
  name: string;
  bytes: Uint8Array;
};

const PDF_FILTER = [{ name: "PDF", extensions: ["pdf", "application/pdf"] }];

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function openPdfFromDialog(): Promise<OpenedPdfFile | null> {
  const selected = await openDialog({
    title: "Open PDF",
    multiple: false,
    filters: PDF_FILTER,
    pickerMode: "document",
    fileAccessMode: "scoped",
  });

  if (!selected || Array.isArray(selected)) {
    return null;
  }

  const bytes = await readFile(selected);
  return {
    path: selected,
    name: basename(selected),
    bytes,
  };
}

export async function savePdfFromDialog(bytes: Uint8Array, sourcePath: string | null): Promise<string | null> {
  const target = await saveDialog({
    title: "Export PDF",
    filters: PDF_FILTER,
    defaultPath: getDefaultExportPath(sourcePath),
    canCreateDirectories: true,
  });

  if (!target) {
    return null;
  }

  await writeFile(target, bytes);
  return target;
}

export function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

export function getDefaultExportPath(sourcePath: string | null): string {
  const fallback = "document-inked.pdf";

  if (!sourcePath) {
    return fallback;
  }

  const separatorIndex = Math.max(sourcePath.lastIndexOf("\\"), sourcePath.lastIndexOf("/"));
  const directory = separatorIndex >= 0 ? sourcePath.slice(0, separatorIndex + 1) : "";
  const fileName = separatorIndex >= 0 ? sourcePath.slice(separatorIndex + 1) : sourcePath;
  const baseName = fileName.replace(/\.pdf$/i, "") || "document";

  return `${directory}${baseName}-inked.pdf`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}
