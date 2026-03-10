using System.IO;
using DSPanel.Services.Settings;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Moq;

namespace DSPanel.Tests.Services.Settings;

public class AppSettingsServiceTests : IDisposable
{
    private readonly string _tempPath;
    private readonly Mock<ILogger<AppSettingsService>> _logger = new();

    public AppSettingsServiceTests()
    {
        _tempPath = Path.Combine(Path.GetTempPath(), $"dspanel-test-{Guid.NewGuid()}.json");
    }

    public void Dispose()
    {
        if (File.Exists(_tempPath))
            File.Delete(_tempPath);
    }

    private AppSettingsService CreateSut() => new(_logger.Object, _tempPath);

    [Fact]
    public void Current_ReturnsNonNull()
    {
        var sut = CreateSut();

        sut.Current.Should().NotBeNull();
    }

    [Fact]
    public void Current_HasDefaultTheme_WhenNoFile()
    {
        var sut = CreateSut();

        sut.Current.Theme.Should().Be("Light");
    }

    [Fact]
    public void Current_PresetsPath_DefaultsToNull()
    {
        var sut = CreateSut();

        sut.Current.PresetsPath.Should().BeNull();
    }

    [Fact]
    public void Save_DoesNotThrow()
    {
        var sut = CreateSut();
        sut.Current.Theme = "Dark";

        var act = () => sut.Save();

        act.Should().NotThrow();
    }

    [Fact]
    public void Save_CreatesJsonFile()
    {
        var sut = CreateSut();
        sut.Save();

        File.Exists(_tempPath).Should().BeTrue();
    }

    [Fact]
    public void Save_ThenReload_PersistsTheme()
    {
        var sut = CreateSut();
        sut.Current.Theme = "Dark";
        sut.Save();

        var sut2 = CreateSut();

        sut2.Current.Theme.Should().Be("Dark");
    }

    [Fact]
    public void Save_ThenReload_PersistsPresetsPath()
    {
        var sut = CreateSut();
        sut.Current.PresetsPath = @"C:\Presets\config.yaml";
        sut.Save();

        var sut2 = CreateSut();

        sut2.Current.PresetsPath.Should().Be(@"C:\Presets\config.yaml");
    }
}
