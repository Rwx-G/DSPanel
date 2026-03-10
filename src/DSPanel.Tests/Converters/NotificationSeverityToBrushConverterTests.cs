using System.Globalization;
using System.Windows;
using System.Windows.Media;
using DSPanel.Converters;
using DSPanel.Services.Notifications;
using DSPanel.Tests.TestHelpers;
using FluentAssertions;

namespace DSPanel.Tests.Converters;

[Collection("WpfApp")]
public class NotificationSeverityToBrushConverterTests
{
    private readonly NotificationSeverityToBrushConverter _converter = new();

    [Theory]
    [InlineData(NotificationSeverity.Success)]
    [InlineData(NotificationSeverity.Warning)]
    [InlineData(NotificationSeverity.Error)]
    [InlineData(NotificationSeverity.Info)]
    public void Convert_AllSeverities_ReturnsBrush(NotificationSeverity severity)
    {
        var result = _converter.Convert(severity, typeof(Brush), null, CultureInfo.InvariantCulture);
        result.Should().BeAssignableTo<Brush>();
    }

    [Fact]
    public void Convert_Success_ReturnsSuccessBrush()
    {
        var result = (SolidColorBrush)_converter.Convert(
            NotificationSeverity.Success, typeof(Brush), null, CultureInfo.InvariantCulture);
        result.Color.Should().Be(Color.FromRgb(22, 163, 74));
    }

    [Fact]
    public void Convert_Warning_ReturnsWarningBrush()
    {
        var result = (SolidColorBrush)_converter.Convert(
            NotificationSeverity.Warning, typeof(Brush), null, CultureInfo.InvariantCulture);
        result.Color.Should().Be(Color.FromRgb(217, 119, 6));
    }

    [Fact]
    public void Convert_Error_ReturnsErrorBrush()
    {
        var result = (SolidColorBrush)_converter.Convert(
            NotificationSeverity.Error, typeof(Brush), null, CultureInfo.InvariantCulture);
        result.Color.Should().Be(Color.FromRgb(220, 38, 38));
    }

    [Fact]
    public void Convert_Info_ReturnsInfoBrush()
    {
        var result = (SolidColorBrush)_converter.Convert(
            NotificationSeverity.Info, typeof(Brush), null, CultureInfo.InvariantCulture);
        result.Color.Should().Be(Color.FromRgb(37, 99, 235));
    }

    [Fact]
    public void Convert_InvalidType_ReturnsUnsetValue()
    {
        var result = _converter.Convert("not a severity", typeof(Brush), null!, CultureInfo.InvariantCulture);
        result.Should().Be(DependencyProperty.UnsetValue);
    }

    [Fact]
    public void Convert_FallbackToGray_WhenResourceNotBrush()
    {
        var app = System.Windows.Application.Current!;
        var original = app.Resources["BrushSuccess"];
        app.Resources["BrushSuccess"] = "not-a-brush";
        try
        {
            var result = _converter.Convert(NotificationSeverity.Success, typeof(Brush), null!, CultureInfo.InvariantCulture);
            result.Should().Be(Brushes.Gray);
        }
        finally
        {
            app.Resources["BrushSuccess"] = original;
        }
    }

    [Fact]
    public void Convert_NullValue_ReturnsUnsetValue()
    {
        var result = _converter.Convert(null!, typeof(Brush), null!, CultureInfo.InvariantCulture);
        result.Should().Be(DependencyProperty.UnsetValue);
    }

    [Fact]
    public void ConvertBack_ThrowsNotSupportedException()
    {
        var act = () => _converter.ConvertBack(null!, typeof(NotificationSeverity), null!, CultureInfo.InvariantCulture);
        act.Should().Throw<NotSupportedException>();
    }
}
