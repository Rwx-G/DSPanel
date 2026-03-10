using System.IO;
using System.Text;
using DSPanel.Services.Dialog;
using Microsoft.Extensions.Logging;

namespace DSPanel.Services.Export;

public sealed class CsvExportService : ICsvExportService
{
    private readonly ILogger<CsvExportService> _logger;
    private readonly IFileDialogService _fileDialog;

    public CsvExportService(ILogger<CsvExportService> logger, IFileDialogService fileDialog)
    {
        _logger = logger;
        _fileDialog = fileDialog;
    }

    public bool ExportToCsv(IReadOnlyList<string> headers, IReadOnlyList<IReadOnlyList<string>> rows)
    {
        var path = _fileDialog.ShowSaveFileDialog("CSV files (*.csv)|*.csv", ".csv", "export.csv");

        if (path is null)
            return false;

        try
        {
            var csv = FormatCsv(headers, rows);
            File.WriteAllText(path, csv, Encoding.UTF8);
            _logger.LogInformation("CSV exported to {Path} ({Rows} rows)", path, rows.Count);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to export CSV to {Path}", path);
            return false;
        }
    }

    public string FormatCsv(IReadOnlyList<string> headers, IReadOnlyList<IReadOnlyList<string>> rows)
    {
        var sb = new StringBuilder();
        sb.AppendLine(string.Join(",", headers.Select(EscapeField)));

        foreach (var row in rows)
        {
            sb.AppendLine(string.Join(",", row.Select(EscapeField)));
        }

        return sb.ToString();
    }

    private static string EscapeField(string field)
    {
        if (field.Contains(',') || field.Contains('"') || field.Contains('\n'))
            return $"\"{field.Replace("\"", "\"\"")}\"";
        return field;
    }
}
