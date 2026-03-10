using System.IO;
using System.Text;
using DSPanel.Services.Dialog;
using DSPanel.Services.Export;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace DSPanel.Tests.Services.Export;

public sealed class CsvExportServiceTests : IDisposable
{
    private readonly Mock<IFileDialogService> _fileDialogMock = new();
    private readonly CsvExportService _sut;
    private readonly List<string> _tempFiles = new();

    public CsvExportServiceTests()
    {
        _sut = new CsvExportService(NullLogger<CsvExportService>.Instance, _fileDialogMock.Object);
    }

    public void Dispose()
    {
        foreach (var file in _tempFiles)
        {
            if (File.Exists(file))
                File.Delete(file);
        }
    }

    private string CreateTempFile()
    {
        var path = Path.Combine(Path.GetTempPath(), $"csv_test_{Guid.NewGuid()}.csv");
        _tempFiles.Add(path);
        return path;
    }

    // --- FormatCsv tests (existing, migrated to FluentAssertions) ---

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
        lines.Should().HaveCount(3);
        lines[0].Should().Be("Name,Age,City");
        lines[1].Should().Be("Alice,30,Paris");
        lines[2].Should().Be("Bob,25,Lyon");
    }

    [Fact]
    public void FormatCsv_FieldWithComma_IsQuoted()
    {
        var headers = new[] { "Name" };
        var rows = new[] { (IReadOnlyList<string>)new[] { "Doe, John" } };

        var csv = _sut.FormatCsv(headers, rows);

        csv.Should().Contain("\"Doe, John\"");
    }

    [Fact]
    public void FormatCsv_FieldWithQuotes_AreEscaped()
    {
        var headers = new[] { "Quote" };
        var rows = new[] { (IReadOnlyList<string>)new[] { "He said \"hello\"" } };

        var csv = _sut.FormatCsv(headers, rows);

        csv.Should().Contain("\"He said \"\"hello\"\"\"");
    }

    [Fact]
    public void FormatCsv_FieldWithNewline_IsQuoted()
    {
        var headers = new[] { "Notes" };
        var rows = new[] { (IReadOnlyList<string>)new[] { "line1\nline2" } };

        var csv = _sut.FormatCsv(headers, rows);

        csv.Should().Contain("\"line1\nline2\"");
    }

    [Fact]
    public void FormatCsv_EmptyRows_OnlyHeaders()
    {
        var headers = new[] { "A", "B" };
        var rows = Array.Empty<IReadOnlyList<string>>();

        var csv = _sut.FormatCsv(headers, rows);

        var lines = csv.Split(Environment.NewLine, StringSplitOptions.RemoveEmptyEntries);
        lines.Should().ContainSingle();
        lines[0].Should().Be("A,B");
    }

    [Fact]
    public void FormatCsv_PlainField_NotQuoted()
    {
        var headers = new[] { "Name" };
        var rows = new[] { (IReadOnlyList<string>)new[] { "Alice" } };

        var csv = _sut.FormatCsv(headers, rows);

        var lines = csv.Split(Environment.NewLine, StringSplitOptions.RemoveEmptyEntries);
        lines[1].Should().Be("Alice");
    }

    // --- ExportToCsv tests ---

    [Fact]
    public void ExportToCsv_DialogCancelled_ReturnsFalse()
    {
        _fileDialogMock
            .Setup(d => d.ShowSaveFileDialog(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()))
            .Returns((string?)null);

        var headers = new[] { "A" };
        var rows = new[] { (IReadOnlyList<string>)new[] { "1" } };

        var result = _sut.ExportToCsv(headers, rows);

        result.Should().BeFalse();
    }

    [Fact]
    public void ExportToCsv_DialogConfirmed_WritesFileAndReturnsTrue()
    {
        var tempPath = CreateTempFile();

        _fileDialogMock
            .Setup(d => d.ShowSaveFileDialog(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()))
            .Returns(tempPath);

        var headers = new[] { "Name", "Value" };
        var rows = new[]
        {
            (IReadOnlyList<string>)new[] { "key1", "val1" },
            new[] { "key2", "val2" }
        };

        var result = _sut.ExportToCsv(headers, rows);

        result.Should().BeTrue();
        File.Exists(tempPath).Should().BeTrue();

        var content = File.ReadAllText(tempPath, Encoding.UTF8);
        var lines = content.Split(Environment.NewLine, StringSplitOptions.RemoveEmptyEntries);
        lines.Should().HaveCount(3);
        lines[0].Should().Be("Name,Value");
        lines[1].Should().Be("key1,val1");
        lines[2].Should().Be("key2,val2");
    }

    [Fact]
    public void ExportToCsv_FileWriteThrows_ReturnsFalse()
    {
        // Use an invalid path that will cause File.WriteAllText to throw
        var invalidPath = Path.Combine(Path.GetTempPath(), $"nonexistent_{Guid.NewGuid()}", "file.csv");

        _fileDialogMock
            .Setup(d => d.ShowSaveFileDialog(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()))
            .Returns(invalidPath);

        var headers = new[] { "A" };
        var rows = new[] { (IReadOnlyList<string>)new[] { "1" } };

        var result = _sut.ExportToCsv(headers, rows);

        result.Should().BeFalse();
    }

    [Fact]
    public void ExportToCsv_DialogConfirmed_PassesCorrectFilterParameters()
    {
        var tempPath = CreateTempFile();

        _fileDialogMock
            .Setup(d => d.ShowSaveFileDialog("CSV files (*.csv)|*.csv", ".csv", "export.csv"))
            .Returns(tempPath);

        var headers = new[] { "A" };
        var rows = new[] { (IReadOnlyList<string>)new[] { "1" } };

        _sut.ExportToCsv(headers, rows);

        _fileDialogMock.Verify(
            d => d.ShowSaveFileDialog("CSV files (*.csv)|*.csv", ".csv", "export.csv"),
            Times.Once);
    }
}
