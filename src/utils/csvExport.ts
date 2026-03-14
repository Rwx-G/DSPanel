import { invoke } from "@tauri-apps/api/core";

export function escapeCsvField(field: string): string {
  if (
    field.includes(",") ||
    field.includes('"') ||
    field.includes("\n") ||
    field.includes("\r")
  ) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

export function formatCsv(headers: string[], rows: string[][]): string {
  const headerLine = headers.map(escapeCsvField).join(",");
  const dataLines = rows.map((row) => row.map(escapeCsvField).join(","));
  return [headerLine, ...dataLines].join("\n");
}

export async function downloadCsv(
  filename: string,
  csvContent: string,
): Promise<string | null> {
  const result = await invoke<string | null>("save_file_dialog", {
    content: csvContent,
    defaultName: filename,
    filterName: "CSV files",
    filterExtensions: ["csv"],
  });
  return result;
}
