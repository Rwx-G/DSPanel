using System.IO;
using System.Windows.Markup;
using System.Windows;
using FluentAssertions;

namespace DSPanel.Tests.Services.Theme;

public class ThemeResourceTests
{
    private static readonly string[] ExpectedColorKeys =
    [
        "ColorPrimary", "ColorPrimaryHover", "ColorPrimaryPressed", "ColorPrimaryLight",
        "ColorSecondary", "ColorSecondaryHover",
        "ColorAccent", "ColorAccentHover",
        "ColorSuccess", "ColorSuccessLight", "ColorWarning", "ColorWarningLight",
        "ColorError", "ColorErrorLight", "ColorInfo", "ColorInfoLight",
        "ColorSurfaceBackground", "ColorSurfaceCard", "ColorSurfaceElevated", "ColorSurfaceOverlay",
        "ColorTextPrimary", "ColorTextSecondary", "ColorTextDisabled", "ColorTextInverse", "ColorTextLink",
        "ColorBorderDefault", "ColorBorderStrong", "ColorBorderSubtle", "ColorBorderFocus",
        "ColorRowAlternate", "ColorRowHover", "ColorRowSelected"
    ];

    private static readonly string[] ExpectedBrushKeys =
    [
        "BrushPrimary", "BrushPrimaryHover", "BrushPrimaryPressed", "BrushPrimaryLight",
        "BrushSecondary", "BrushAccent",
        "BrushSuccess", "BrushSuccessLight", "BrushWarning", "BrushWarningLight",
        "BrushError", "BrushErrorLight", "BrushInfo", "BrushInfoLight",
        "BrushSurfaceBackground", "BrushSurfaceCard", "BrushSurfaceElevated",
        "BrushTextPrimary", "BrushTextSecondary", "BrushTextDisabled", "BrushTextInverse", "BrushTextLink",
        "BrushBorderDefault", "BrushBorderStrong", "BrushBorderSubtle", "BrushBorderFocus",
        "BrushRowAlternate", "BrushRowHover", "BrushRowSelected"
    ];

    private static ResourceDictionary LoadThemeFromFile(string fileName)
    {
        var projectDir = FindProjectDir();
        var filePath = Path.Combine(projectDir, "src", "DSPanel", "Resources", "Styles", fileName);

        using var stream = File.OpenRead(filePath);
        return (ResourceDictionary)XamlReader.Load(stream);
    }

    private static string FindProjectDir()
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir, "DSPanel.slnx")))
                return dir;
            dir = Path.GetDirectoryName(dir);
        }
        throw new InvalidOperationException("Could not find solution root directory");
    }

    [Theory]
    [MemberData(nameof(GetColorKeys))]
    public void LightTheme_ContainsAllColorKeys(string key)
    {
        var theme = LoadThemeFromFile("LightTheme.xaml");
        theme.Contains(key).Should().BeTrue($"LightTheme should contain key '{key}'");
    }

    [Theory]
    [MemberData(nameof(GetColorKeys))]
    public void DarkTheme_ContainsAllColorKeys(string key)
    {
        var theme = LoadThemeFromFile("DarkTheme.xaml");
        theme.Contains(key).Should().BeTrue($"DarkTheme should contain key '{key}'");
    }

    [Theory]
    [MemberData(nameof(GetBrushKeys))]
    public void LightTheme_ContainsAllBrushKeys(string key)
    {
        var theme = LoadThemeFromFile("LightTheme.xaml");
        theme.Contains(key).Should().BeTrue($"LightTheme should contain brush '{key}'");
    }

    [Theory]
    [MemberData(nameof(GetBrushKeys))]
    public void DarkTheme_ContainsAllBrushKeys(string key)
    {
        var theme = LoadThemeFromFile("DarkTheme.xaml");
        theme.Contains(key).Should().BeTrue($"DarkTheme should contain brush '{key}'");
    }

    [Fact]
    public void BothThemes_DefineSameKeySet()
    {
        var light = LoadThemeFromFile("LightTheme.xaml");
        var dark = LoadThemeFromFile("DarkTheme.xaml");

        var lightKeys = light.Keys.Cast<object>().Select(k => k.ToString()!).OrderBy(k => k).ToList();
        var darkKeys = dark.Keys.Cast<object>().Select(k => k.ToString()!).OrderBy(k => k).ToList();

        lightKeys.Should().BeEquivalentTo(darkKeys, "both themes must define the same set of keys");
    }

    public static IEnumerable<object[]> GetColorKeys() =>
        ExpectedColorKeys.Select(k => new object[] { k });

    public static IEnumerable<object[]> GetBrushKeys() =>
        ExpectedBrushKeys.Select(k => new object[] { k });
}
