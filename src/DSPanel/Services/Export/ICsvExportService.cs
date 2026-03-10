namespace DSPanel.Services.Export;

/// <summary>
/// Exports data to CSV files.
/// </summary>
public interface ICsvExportService
{
    /// <summary>
    /// Exports rows to a CSV file. Opens a SaveFileDialog for path selection.
    /// Returns true if the file was written successfully.
    /// </summary>
    bool ExportToCsv(IReadOnlyList<string> headers, IReadOnlyList<IReadOnlyList<string>> rows);

    /// <summary>
    /// Formats rows as CSV string content.
    /// </summary>
    string FormatCsv(IReadOnlyList<string> headers, IReadOnlyList<IReadOnlyList<string>> rows);
}
