using System.Globalization;
using System.Windows.Media;
using DSPanel.Converters;
using DSPanel.Models;
using DSPanel.Tests.TestHelpers;
using FluentAssertions;

namespace DSPanel.Tests.Converters;

[Collection("WpfApp")]
public class HealthLevelToColorConverterTests
{
    private readonly HealthLevelToColorConverter _converter = new();

    [Theory]
    [InlineData(HealthLevel.Healthy)]
    [InlineData(HealthLevel.Info)]
    [InlineData(HealthLevel.Warning)]
    [InlineData(HealthLevel.Critical)]
    public void Convert_AllHealthLevels_ReturnsBrush(HealthLevel level)
    {
        var result = _converter.Convert(level, typeof(Brush), null, CultureInfo.InvariantCulture);
        result.Should().BeAssignableTo<Brush>();
    }

    [Fact]
    public void Convert_Healthy_ReturnsSuccessBrush()
    {
        var result = (SolidColorBrush)_converter.Convert(HealthLevel.Healthy, typeof(Brush), null, CultureInfo.InvariantCulture);
        result.Color.Should().Be(Color.FromRgb(22, 163, 74));
    }

    [Fact]
    public void Convert_Info_ReturnsInfoBrush()
    {
        var result = (SolidColorBrush)_converter.Convert(HealthLevel.Info, typeof(Brush), null, CultureInfo.InvariantCulture);
        result.Color.Should().Be(Color.FromRgb(37, 99, 235));
    }

    [Fact]
    public void Convert_Warning_ReturnsWarningBrush()
    {
        var result = (SolidColorBrush)_converter.Convert(HealthLevel.Warning, typeof(Brush), null, CultureInfo.InvariantCulture);
        result.Color.Should().Be(Color.FromRgb(217, 119, 6));
    }

    [Fact]
    public void Convert_Critical_ReturnsErrorBrush()
    {
        var result = (SolidColorBrush)_converter.Convert(HealthLevel.Critical, typeof(Brush), null, CultureInfo.InvariantCulture);
        result.Color.Should().Be(Color.FromRgb(220, 38, 38));
    }

    [Fact]
    public void Convert_UnknownEnumValue_FallsBackToGray()
    {
        // (HealthLevel)99 maps to default case "BrushTextSecondary" which is not in fixture
        var result = _converter.Convert((HealthLevel)99, typeof(Brush), null, CultureInfo.InvariantCulture);
        result.Should().Be(Brushes.Gray);
    }

    [Fact]
    public void Convert_NullValue_ReturnsGray()
    {
        var result = _converter.Convert(null, typeof(Brush), null, CultureInfo.InvariantCulture);
        result.Should().Be(Brushes.Gray);
    }

    [Fact]
    public void Convert_NonHealthLevel_ReturnsGray()
    {
        var result = _converter.Convert("invalid", typeof(Brush), null, CultureInfo.InvariantCulture);
        result.Should().Be(Brushes.Gray);
    }

    [Fact]
    public void Convert_Healthy_FallbackWhenResourceMissing()
    {
        var app = System.Windows.Application.Current!;
        var original = app.Resources["BrushSuccess"];
        app.Resources["BrushSuccess"] = "not-a-brush";
        try
        {
            var result = _converter.Convert(HealthLevel.Healthy, typeof(Brush), null, CultureInfo.InvariantCulture);
            result.Should().Be(Brushes.Green);
        }
        finally
        {
            app.Resources["BrushSuccess"] = original;
        }
    }

    [Fact]
    public void Convert_Info_FallbackWhenResourceMissing()
    {
        var app = System.Windows.Application.Current!;
        var original = app.Resources["BrushInfo"];
        app.Resources["BrushInfo"] = "not-a-brush";
        try
        {
            var result = _converter.Convert(HealthLevel.Info, typeof(Brush), null, CultureInfo.InvariantCulture);
            result.Should().Be(Brushes.DodgerBlue);
        }
        finally
        {
            app.Resources["BrushInfo"] = original;
        }
    }

    [Fact]
    public void Convert_Warning_FallbackWhenResourceMissing()
    {
        var app = System.Windows.Application.Current!;
        var original = app.Resources["BrushWarning"];
        app.Resources["BrushWarning"] = "not-a-brush";
        try
        {
            var result = _converter.Convert(HealthLevel.Warning, typeof(Brush), null, CultureInfo.InvariantCulture);
            result.Should().Be(Brushes.Orange);
        }
        finally
        {
            app.Resources["BrushWarning"] = original;
        }
    }

    [Fact]
    public void Convert_Critical_FallbackWhenResourceMissing()
    {
        var app = System.Windows.Application.Current!;
        var original = app.Resources["BrushError"];
        app.Resources["BrushError"] = "not-a-brush";
        try
        {
            var result = _converter.Convert(HealthLevel.Critical, typeof(Brush), null, CultureInfo.InvariantCulture);
            result.Should().Be(Brushes.Red);
        }
        finally
        {
            app.Resources["BrushError"] = original;
        }
    }

    [Fact]
    public void ConvertBack_ThrowsNotSupportedException()
    {
        var act = () => _converter.ConvertBack(null, typeof(HealthLevel), null, CultureInfo.InvariantCulture);
        act.Should().Throw<NotSupportedException>();
    }
}
