use serde::{Deserialize, Serialize};

use crate::error::AppError;

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/// Defines a column for export: header label, data key, and optional width hint.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnDefinition {
    /// Display header for the column.
    pub header: String,
    /// Key used to look up the value in each row's data map.
    pub key: String,
    /// Optional width hint (percentage or character count) for PDF/XLSX formatting.
    pub width_hint: Option<f32>,
}

/// Options for CSV export.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvOptions {
    /// Delimiter character: comma, semicolon, or tab.
    pub delimiter: CsvDelimiter,
    /// Whether to include a header row.
    pub include_headers: bool,
}

impl Default for CsvOptions {
    fn default() -> Self {
        Self {
            delimiter: CsvDelimiter::Comma,
            include_headers: true,
        }
    }
}

/// Supported CSV delimiter types.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CsvDelimiter {
    Comma,
    Semicolon,
    Tab,
}

impl CsvDelimiter {
    pub fn as_byte(&self) -> u8 {
        match self {
            CsvDelimiter::Comma => b',',
            CsvDelimiter::Semicolon => b';',
            CsvDelimiter::Tab => b'\t',
        }
    }
}

/// A row of export data: ordered values matching the column definitions.
pub type ExportRow = Vec<String>;

// ---------------------------------------------------------------------------
// CSV Export
// ---------------------------------------------------------------------------

/// Exports tabular data to CSV format with UTF-8 BOM.
pub fn export_to_csv(
    columns: &[ColumnDefinition],
    rows: &[ExportRow],
    options: &CsvOptions,
) -> Result<Vec<u8>, AppError> {
    let mut buf: Vec<u8> = Vec::new();

    // Write UTF-8 BOM
    buf.extend_from_slice(&[0xEF, 0xBB, 0xBF]);

    let mut writer = csv::WriterBuilder::new()
        .delimiter(options.delimiter.as_byte())
        .from_writer(&mut buf);

    if options.include_headers {
        let headers: Vec<&str> = columns.iter().map(|c| c.header.as_str()).collect();
        writer
            .write_record(&headers)
            .map_err(|e| AppError::Internal(format!("CSV header write error: {e}")))?;
    }

    for row in rows {
        writer
            .write_record(row)
            .map_err(|e| AppError::Internal(format!("CSV row write error: {e}")))?;
    }

    writer
        .flush()
        .map_err(|e| AppError::Internal(format!("CSV flush error: {e}")))?;
    drop(writer);

    Ok(buf)
}

// ---------------------------------------------------------------------------
// HTML Export
// ---------------------------------------------------------------------------

/// Exports tabular data to a self-contained HTML file with inline CSS.
pub fn export_to_html(
    columns: &[ColumnDefinition],
    rows: &[ExportRow],
    title: &str,
) -> Result<String, AppError> {
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let mut html = String::with_capacity(4096 + rows.len() * 256);

    html.push_str("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n");
    html.push_str(&format!("<title>{}</title>\n", html_escape(title)));
    html.push_str("<style>\n");
    html.push_str(
        "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;\
         margin:2rem;color:#1a1a2e;background:#fff}\
         h1{font-size:1.4rem;margin-bottom:.25rem}\
         .meta{color:#666;font-size:.85rem;margin-bottom:1.5rem}\
         table{border-collapse:collapse;width:100%;font-size:.85rem}\
         th{background:#1a1a2e;color:#fff;text-align:left;padding:8px 12px;font-weight:600}\
         td{padding:6px 12px;border-bottom:1px solid #e0e0e0}\
         tr:nth-child(even){background:#f8f9fa}\
         tr:hover{background:#e8eaf6}\n",
    );
    html.push_str("</style>\n</head>\n<body>\n");

    html.push_str(&format!("<h1>{}</h1>\n", html_escape(title)));
    html.push_str(&format!(
        "<p class=\"meta\">Generated: {} - {} rows</p>\n",
        html_escape(&timestamp),
        rows.len()
    ));

    html.push_str("<table>\n<thead>\n<tr>\n");
    for col in columns {
        html.push_str(&format!("<th>{}</th>", html_escape(&col.header)));
    }
    html.push_str("\n</tr>\n</thead>\n<tbody>\n");

    for row in rows {
        html.push_str("<tr>");
        for (i, _col) in columns.iter().enumerate() {
            let value = row.get(i).map(|s| s.as_str()).unwrap_or("");
            html.push_str(&format!("<td>{}</td>", html_escape(value)));
        }
        html.push_str("</tr>\n");
    }

    html.push_str("</tbody>\n</table>\n</body>\n</html>");

    Ok(html)
}

/// Escapes HTML special characters.
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

// ---------------------------------------------------------------------------
// PDF Export
// ---------------------------------------------------------------------------

/// Exports tabular data to PDF format using printpdf with built-in Helvetica font.
pub fn export_to_pdf(
    columns: &[ColumnDefinition],
    rows: &[ExportRow],
    title: &str,
) -> Result<Vec<u8>, AppError> {
    use printpdf::*;

    let page_width_mm: f32 = 297.0; // A4 landscape width
    let page_height_mm: f32 = 210.0; // A4 landscape height
    let margin: f32 = 15.0;
    let usable_width = page_width_mm - 2.0 * margin;

    let font_regular = PdfFontHandle::Builtin(BuiltinFont::Helvetica);
    let font_bold = PdfFontHandle::Builtin(BuiltinFont::HelveticaBold);

    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let col_count = columns.len();
    let col_width = if col_count > 0 {
        usable_width / col_count as f32
    } else {
        usable_width
    };

    let title_size: f32 = 14.0;
    let meta_size: f32 = 8.0;
    let header_size: f32 = 7.0;
    let cell_size: f32 = 6.5;
    let row_height: f32 = 5.0;
    let header_row_height: f32 = 6.0;

    /// Helper: emit ops to write text at (x, y) with given font and size.
    fn text_ops(
        text: &str,
        size: f32,
        x: f32,
        y: f32,
        font: &PdfFontHandle,
    ) -> Vec<Op> {
        vec![
            Op::StartTextSection,
            Op::SetTextCursor { pos: Point { x: Mm(x).into(), y: Mm(y).into() } },
            Op::SetFont { font: font.clone(), size: Pt(size) },
            Op::ShowText { items: vec![TextItem::Text(text.to_string())] },
            Op::EndTextSection,
        ]
    }

    let mut pages: Vec<PdfPage> = Vec::new();
    let mut ops: Vec<Op> = Vec::new();
    let mut y = page_height_mm - margin;
    let mut page_num = 1;
    // Title + meta + header on first page
    ops.extend(text_ops(title, title_size, margin, y, &font_bold));
    y -= title_size * 0.5 + 2.0;

    let meta_text = format!("Generated: {} - {} rows", timestamp, rows.len());
    ops.extend(text_ops(&meta_text, meta_size, margin, y, &font_regular));
    y -= meta_size * 0.5 + 4.0;

    for (i, col) in columns.iter().enumerate() {
        let x = margin + i as f32 * col_width;
        let header_text = truncate_for_col(&col.header, col_width, header_size);
        ops.extend(text_ops(&header_text, header_size, x + 1.0, y, &font_bold));
    }
    y -= header_row_height + 1.0;

    // Data rows
    for row in rows {
        if y < margin + 10.0 {
            // Footer on current page
            let footer = format!("Page {page_num}");
            ops.extend(text_ops(
                &footer, 7.0, page_width_mm / 2.0 - 5.0, 5.0, &font_regular,
            ));

            // Finalize current page
            pages.push(PdfPage::new(Mm(page_width_mm), Mm(page_height_mm), ops));
            ops = Vec::new();
            page_num += 1;
            y = page_height_mm - margin;
        }

        for (i, _col) in columns.iter().enumerate() {
            let x = margin + i as f32 * col_width;
            let value = row.get(i).map(|s| s.as_str()).unwrap_or("");
            let display = truncate_for_col(value, col_width, cell_size);
            ops.extend(text_ops(&display, cell_size, x + 1.0, y, &font_regular));
        }
        y -= row_height;
    }

    // Footer on last page
    let footer = format!("Page {page_num}");
    ops.extend(text_ops(
        &footer, 7.0, page_width_mm / 2.0 - 5.0, 5.0, &font_regular,
    ));
    pages.push(PdfPage::new(Mm(page_width_mm), Mm(page_height_mm), ops));

    let mut doc = PdfDocument::new(title);
    let doc = doc.with_pages(pages);
    let bytes = doc.save(&PdfSaveOptions::default(), &mut Vec::new());

    Ok(bytes)
}

/// Truncates text to approximately fit a column width in mm at a given font size.
fn truncate_for_col(text: &str, col_width_mm: f32, font_size: f32) -> String {
    // Approximate: 1 char ~ font_size * 0.35 mm for Helvetica
    let max_chars = (col_width_mm / (font_size * 0.35)) as usize;
    if max_chars == 0 {
        return String::new();
    }
    if text.len() <= max_chars {
        text.to_string()
    } else if max_chars > 3 {
        format!("{}...", &text[..max_chars - 3])
    } else {
        text[..max_chars].to_string()
    }
}

// ---------------------------------------------------------------------------
// XLSX Export
// ---------------------------------------------------------------------------

/// Exports tabular data to XLSX format.
pub fn export_to_xlsx(
    columns: &[ColumnDefinition],
    rows: &[ExportRow],
    sheet_name: &str,
) -> Result<Vec<u8>, AppError> {
    use rust_xlsxwriter::{Format, Workbook};

    let mut workbook = Workbook::new();

    // Truncate sheet name to Excel's 31-char limit
    let safe_name = if sheet_name.len() > 31 {
        &sheet_name[..31]
    } else {
        sheet_name
    };

    let worksheet = workbook
        .add_worksheet()
        .set_name(safe_name)
        .map_err(|e| AppError::Internal(format!("XLSX worksheet error: {e}")))?;

    let header_format = Format::new().set_bold();

    // Write headers
    for (col_idx, col) in columns.iter().enumerate() {
        worksheet
            .write_string_with_format(0, col_idx as u16, &col.header, &header_format)
            .map_err(|e| AppError::Internal(format!("XLSX header write error: {e}")))?;
    }

    // Write data rows
    for (row_idx, row) in rows.iter().enumerate() {
        let excel_row = (row_idx + 1) as u32; // +1 to skip header
        for (col_idx, _col) in columns.iter().enumerate() {
            let value = row.get(col_idx).map(|s| s.as_str()).unwrap_or("");

            // Try numeric parse for better Excel behavior
            if let Ok(num) = value.parse::<f64>() {
                worksheet
                    .write_number(excel_row, col_idx as u16, num)
                    .map_err(|e| AppError::Internal(format!("XLSX number write error: {e}")))?;
            } else {
                worksheet
                    .write_string(excel_row, col_idx as u16, value)
                    .map_err(|e| AppError::Internal(format!("XLSX string write error: {e}")))?;
            }
        }
    }

    // Auto-filter on all columns
    if !columns.is_empty() {
        let last_row = rows.len() as u32;
        let last_col = (columns.len() - 1) as u16;
        worksheet
            .autofilter(0, 0, last_row, last_col)
            .map_err(|e| AppError::Internal(format!("XLSX autofilter error: {e}")))?;
    }

    // Auto-fit column widths (approximate based on content)
    for (col_idx, col) in columns.iter().enumerate() {
        let header_len = col.header.len();
        let max_data_len = rows
            .iter()
            .map(|r| r.get(col_idx).map(|s| s.len()).unwrap_or(0))
            .max()
            .unwrap_or(0);
        let width = (header_len.max(max_data_len) as f64 * 1.2).clamp(8.0, 50.0);
        worksheet
            .set_column_width(col_idx as u16, width)
            .map_err(|e| AppError::Internal(format!("XLSX column width error: {e}")))?;
    }

    let buf = workbook
        .save_to_buffer()
        .map_err(|e| AppError::Internal(format!("XLSX save error: {e}")))?;

    Ok(buf)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    fn sample_columns() -> Vec<ColumnDefinition> {
        vec![
            ColumnDefinition {
                header: "Name".to_string(),
                key: "name".to_string(),
                width_hint: None,
            },
            ColumnDefinition {
                header: "Email".to_string(),
                key: "email".to_string(),
                width_hint: None,
            },
            ColumnDefinition {
                header: "Age".to_string(),
                key: "age".to_string(),
                width_hint: None,
            },
        ]
    }

    fn sample_rows() -> Vec<ExportRow> {
        vec![
            vec![
                "Alice".to_string(),
                "alice@example.com".to_string(),
                "30".to_string(),
            ],
            vec![
                "Bob".to_string(),
                "bob@example.com".to_string(),
                "25".to_string(),
            ],
        ]
    }

    // -- CSV tests --

    #[test]
    fn csv_export_has_utf8_bom() {
        let cols = sample_columns();
        let rows = sample_rows();
        let result = export_to_csv(&cols, &rows, &CsvOptions::default()).unwrap();
        assert_eq!(&result[..3], &[0xEF, 0xBB, 0xBF]);
    }

    #[test]
    fn csv_export_includes_headers() {
        let cols = sample_columns();
        let rows = sample_rows();
        let result = export_to_csv(&cols, &rows, &CsvOptions::default()).unwrap();
        let content = String::from_utf8(result).unwrap();
        assert!(content.contains("Name,Email,Age"));
    }

    #[test]
    fn csv_export_includes_data() {
        let cols = sample_columns();
        let rows = sample_rows();
        let result = export_to_csv(&cols, &rows, &CsvOptions::default()).unwrap();
        let content = String::from_utf8(result).unwrap();
        assert!(content.contains("Alice,alice@example.com,30"));
        assert!(content.contains("Bob,bob@example.com,25"));
    }

    #[test]
    fn csv_export_semicolon_delimiter() {
        let cols = sample_columns();
        let rows = sample_rows();
        let options = CsvOptions {
            delimiter: CsvDelimiter::Semicolon,
            include_headers: true,
        };
        let result = export_to_csv(&cols, &rows, &options).unwrap();
        let content = String::from_utf8(result).unwrap();
        assert!(content.contains("Name;Email;Age"));
    }

    #[test]
    fn csv_export_tab_delimiter() {
        let cols = sample_columns();
        let rows = sample_rows();
        let options = CsvOptions {
            delimiter: CsvDelimiter::Tab,
            include_headers: true,
        };
        let result = export_to_csv(&cols, &rows, &options).unwrap();
        let content = String::from_utf8(result).unwrap();
        assert!(content.contains("Name\tEmail\tAge"));
    }

    #[test]
    fn csv_export_no_headers() {
        let cols = sample_columns();
        let rows = sample_rows();
        let options = CsvOptions {
            delimiter: CsvDelimiter::Comma,
            include_headers: false,
        };
        let result = export_to_csv(&cols, &rows, &options).unwrap();
        let content = String::from_utf8(result).unwrap();
        assert!(!content.contains("Name,Email,Age"));
        assert!(content.contains("Alice"));
    }

    #[test]
    fn csv_export_empty_rows() {
        let cols = sample_columns();
        let rows: Vec<ExportRow> = vec![];
        let result = export_to_csv(&cols, &rows, &CsvOptions::default()).unwrap();
        let content = String::from_utf8(result).unwrap();
        assert!(content.contains("Name,Email,Age"));
        // Only BOM + header, no data lines
        let lines: Vec<&str> = content.trim().lines().collect();
        assert_eq!(lines.len(), 1);
    }

    #[test]
    fn csv_export_special_chars_escaped() {
        let cols = sample_columns();
        let rows = vec![vec![
            "O'Brien, Jr.".to_string(),
            "ob@test.com".to_string(),
            "40".to_string(),
        ]];
        let result = export_to_csv(&cols, &rows, &CsvOptions::default()).unwrap();
        let content = String::from_utf8(result).unwrap();
        // csv crate should quote the field containing comma
        assert!(content.contains("\"O'Brien, Jr.\""));
    }

    // -- HTML tests --

    #[test]
    fn html_export_is_valid_structure() {
        let cols = sample_columns();
        let rows = sample_rows();
        let result = export_to_html(&cols, &rows, "Test Report").unwrap();
        assert!(result.starts_with("<!DOCTYPE html>"));
        assert!(result.contains("<html"));
        assert!(result.contains("</html>"));
        assert!(result.contains("<table>"));
        assert!(result.contains("</table>"));
    }

    #[test]
    fn html_export_contains_title() {
        let cols = sample_columns();
        let rows = sample_rows();
        let result = export_to_html(&cols, &rows, "My Export").unwrap();
        assert!(result.contains("<h1>My Export</h1>"));
        assert!(result.contains("<title>My Export</title>"));
    }

    #[test]
    fn html_export_contains_headers() {
        let cols = sample_columns();
        let rows = sample_rows();
        let result = export_to_html(&cols, &rows, "Test").unwrap();
        assert!(result.contains("<th>Name</th>"));
        assert!(result.contains("<th>Email</th>"));
        assert!(result.contains("<th>Age</th>"));
    }

    #[test]
    fn html_export_contains_data() {
        let cols = sample_columns();
        let rows = sample_rows();
        let result = export_to_html(&cols, &rows, "Test").unwrap();
        assert!(result.contains("<td>Alice</td>"));
        assert!(result.contains("<td>bob@example.com</td>"));
    }

    #[test]
    fn html_export_has_inline_css() {
        let cols = sample_columns();
        let rows = sample_rows();
        let result = export_to_html(&cols, &rows, "Test").unwrap();
        assert!(result.contains("<style>"));
        assert!(result.contains("border-collapse"));
    }

    #[test]
    fn html_export_escapes_special_chars() {
        let cols = sample_columns();
        let rows = vec![vec![
            "<script>alert('xss')</script>".to_string(),
            "a&b".to_string(),
            "1".to_string(),
        ]];
        let result = export_to_html(&cols, &rows, "Test").unwrap();
        assert!(!result.contains("<script>"));
        assert!(result.contains("&lt;script&gt;"));
        assert!(result.contains("a&amp;b"));
    }

    #[test]
    fn html_export_shows_row_count() {
        let cols = sample_columns();
        let rows = sample_rows();
        let result = export_to_html(&cols, &rows, "Test").unwrap();
        assert!(result.contains("2 rows"));
    }

    #[test]
    fn html_export_contains_timestamp() {
        let cols = sample_columns();
        let rows = sample_rows();
        let result = export_to_html(&cols, &rows, "Test").unwrap();
        assert!(result.contains("Generated:"));
    }

    // -- XLSX tests --

    #[test]
    fn xlsx_export_produces_valid_file() {
        let cols = sample_columns();
        let rows = sample_rows();
        let result = export_to_xlsx(&cols, &rows, "TestSheet").unwrap();
        // XLSX files start with PK zip signature
        assert!(result.len() > 4);
        assert_eq!(&result[..2], b"PK");
    }

    #[test]
    fn xlsx_export_empty_data() {
        let cols = sample_columns();
        let rows: Vec<ExportRow> = vec![];
        let result = export_to_xlsx(&cols, &rows, "Empty").unwrap();
        assert_eq!(&result[..2], b"PK");
    }

    #[test]
    fn xlsx_export_long_sheet_name_truncated() {
        let cols = sample_columns();
        let rows = sample_rows();
        let long_name = "A".repeat(50);
        let result = export_to_xlsx(&cols, &rows, &long_name);
        assert!(result.is_ok());
    }

    #[test]
    fn xlsx_export_numeric_values() {
        let cols = vec![ColumnDefinition {
            header: "Count".to_string(),
            key: "count".to_string(),
            width_hint: None,
        }];
        let rows = vec![
            vec!["42".to_string()],
            vec!["3.14".to_string()],
            vec!["not_a_number".to_string()],
        ];
        let result = export_to_xlsx(&cols, &rows, "Numbers").unwrap();
        assert_eq!(&result[..2], b"PK");
    }

    // -- PDF tests --

    #[test]
    fn pdf_export_produces_valid_file() {
        let cols = sample_columns();
        let rows = sample_rows();
        let result = export_to_pdf(&cols, &rows, "Test Report").unwrap();
        // PDF files start with %PDF
        assert!(result.len() > 4);
        let header = String::from_utf8_lossy(&result[..5]);
        assert!(header.starts_with("%PDF"), "Got: {}", header);
    }

    #[test]
    fn pdf_export_empty_data() {
        let cols = sample_columns();
        let rows: Vec<ExportRow> = vec![];
        let result = export_to_pdf(&cols, &rows, "Empty Report").unwrap();
        let header = String::from_utf8_lossy(&result[..5]);
        assert!(header.starts_with("%PDF"));
    }

    // -- html_escape tests --

    #[test]
    fn html_escape_handles_all_entities() {
        assert_eq!(html_escape("<>&\"'"), "&lt;&gt;&amp;&quot;&#39;");
    }

    #[test]
    fn html_escape_passthrough_normal_text() {
        assert_eq!(html_escape("Hello World"), "Hello World");
    }

    // -- Large dataset tests --

    #[test]
    fn csv_export_large_dataset() {
        let cols = sample_columns();
        let rows: Vec<ExportRow> = (0..2000)
            .map(|i| {
                vec![
                    format!("User {i}"),
                    format!("user{i}@example.com"),
                    format!("{}", 20 + i % 50),
                ]
            })
            .collect();
        let result = export_to_csv(&cols, &rows, &CsvOptions::default()).unwrap();
        let content = String::from_utf8(result).unwrap();
        let line_count = content.lines().count();
        // 1 header + 2000 data rows
        assert_eq!(line_count, 2001);
    }

    #[test]
    fn xlsx_export_large_dataset() {
        let cols = sample_columns();
        let rows: Vec<ExportRow> = (0..1500)
            .map(|i| {
                vec![
                    format!("User {i}"),
                    format!("user{i}@example.com"),
                    format!("{}", 20 + i % 50),
                ]
            })
            .collect();
        let result = export_to_xlsx(&cols, &rows, "LargeSheet").unwrap();
        assert_eq!(&result[..2], b"PK");
        assert!(result.len() > 1000);
    }

    #[test]
    fn html_export_large_dataset() {
        let cols = sample_columns();
        let rows: Vec<ExportRow> = (0..1000)
            .map(|i| {
                vec![
                    format!("User {i}"),
                    format!("user{i}@example.com"),
                    format!("{}", 20 + i % 50),
                ]
            })
            .collect();
        let result = export_to_html(&cols, &rows, "Large Report").unwrap();
        assert!(result.contains("1000 rows"));
        assert!(result.contains("User 999"));
    }
}
