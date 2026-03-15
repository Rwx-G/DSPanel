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

/**
 * Exports DataTable-compatible columns and data to CSV via save dialog.
 *
 * Extracts headers from column definitions and raw string values from
 * each row's keyed properties. Custom render functions are ignored -
 * only raw data values are exported.
 */
export async function exportTableToCsv<T>(
  columns: { key: keyof T & string; header: string }[],
  data: T[],
  filename: string,
): Promise<string | null> {
  const headers = columns.map((col) => col.header);
  const rows = data.map((row) =>
    columns.map((col) => String(row[col.key] ?? "")),
  );
  const csv = formatCsv(headers, rows);
  return downloadCsv(filename, csv);
}
