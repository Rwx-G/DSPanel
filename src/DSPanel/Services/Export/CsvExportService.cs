using System.IO;
using System.Text;
using Microsoft.Extensions.Logging;
using Microsoft.Win32;

namespace DSPanel.Services.Export;

public sealed class CsvExportService : ICsvExportService
{
    private readonly ILogger<CsvExportService> _logger;

    public CsvExportService(ILogger<CsvExportService> logger)
    {
        _logger = logger;
    }

    public bool ExportToCsv(IReadOnlyList<string> headers, IReadOnlyList<IReadOnlyList<string>> rows)
    {
        var dialog = new SaveFileDialog
        {
            Filter = "CSV files (*.csv)|*.csv",
            DefaultExt = ".csv",
            FileName = "export.csv"
        };

        if (dialog.ShowDialog() != true)
            return false;

        try
        {
            var csv = FormatCsv(headers, rows);
            File.WriteAllText(dialog.FileName, csv, Encoding.UTF8);
            _logger.LogInformation("CSV exported to {Path} ({Rows} rows)", dialog.FileName, rows.Count);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to export CSV to {Path}", dialog.FileName);
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
