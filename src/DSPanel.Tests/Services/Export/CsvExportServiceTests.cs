using DSPanel.Services.Export;
using Microsoft.Extensions.Logging.Abstractions;

namespace DSPanel.Tests.Services.Export;

public sealed class CsvExportServiceTests
{
    private readonly CsvExportService _sut = new(NullLogger<CsvExportService>.Instance);

    [Fact]
    public void FormatCsv_SimpleHeaders_ProducesCorrectOutput()
    {
        var headers = new[] { "Name", "Age", "City" };
        var rows = new[]
        {
            (IReadOnlyList<string>)new[] { "Alice", "30", "Paris" },
            new[] { "Bob", "25", "Lyon" }
        };

        var csv = _sut.FormatCsv(headers, rows);

        var lines = csv.Split(Environment.NewLine, StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal(3, lines.Length);
        Assert.Equal("Name,Age,City", lines[0]);
        Assert.Equal("Alice,30,Paris", lines[1]);
        Assert.Equal("Bob,25,Lyon", lines[2]);
    }

    [Fact]
    public void FormatCsv_FieldWithComma_IsQuoted()
    {
        var headers = new[] { "Name" };
        var rows = new[] { (IReadOnlyList<string>)new[] { "Doe, John" } };

        var csv = _sut.FormatCsv(headers, rows);

        Assert.Contains("\"Doe, John\"", csv);
    }

    [Fact]
    public void FormatCsv_FieldWithQuotes_AreEscaped()
    {
        var headers = new[] { "Quote" };
        var rows = new[] { (IReadOnlyList<string>)new[] { "He said \"hello\"" } };

        var csv = _sut.FormatCsv(headers, rows);

        Assert.Contains("\"He said \"\"hello\"\"\"", csv);
    }

    [Fact]
    public void FormatCsv_FieldWithNewline_IsQuoted()
    {
        var headers = new[] { "Notes" };
        var rows = new[] { (IReadOnlyList<string>)new[] { "line1\nline2" } };

        var csv = _sut.FormatCsv(headers, rows);

        Assert.Contains("\"line1\nline2\"", csv);
    }

    [Fact]
    public void FormatCsv_EmptyRows_OnlyHeaders()
    {
        var headers = new[] { "A", "B" };
        var rows = Array.Empty<IReadOnlyList<string>>();

        var csv = _sut.FormatCsv(headers, rows);

        var lines = csv.Split(Environment.NewLine, StringSplitOptions.RemoveEmptyEntries);
        Assert.Single(lines);
        Assert.Equal("A,B", lines[0]);
    }

    [Fact]
    public void FormatCsv_PlainField_NotQuoted()
    {
        var headers = new[] { "Name" };
        var rows = new[] { (IReadOnlyList<string>)new[] { "Alice" } };

        var csv = _sut.FormatCsv(headers, rows);

        var lines = csv.Split(Environment.NewLine, StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal("Alice", lines[1]);
    }
}
