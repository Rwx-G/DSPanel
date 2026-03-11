using System.Globalization;
using System.Windows;
using System.Windows.Media;
using DSPanel.Converters;
using DSPanel.Services.Notifications;
using DSPanel.Tests.TestHelpers;
using FluentAssertions;

namespace DSPanel.Tests.Converters;

[Collection("WpfApp")]
public class NotificationSeverityToIconConverterTests
{
    private readonly NotificationSeverityToIconConverter _converter = new();

    [Theory]
    [InlineData(NotificationSeverity.Success)]
    [InlineData(NotificationSeverity.Warning)]
    [InlineData(NotificationSeverity.Error)]
    [InlineData(NotificationSeverity.Info)]
    public void Convert_AllSeverities_ReturnsGeometry(NotificationSeverity severity)
    {
        var result = _converter.Convert(severity, typeof(Geometry), null, CultureInfo.InvariantCulture);
        result.Should().BeAssignableTo<Geometry>();
    }

    [Fact]
    public void Convert_Success_ReturnsNonEmptyGeometry()
    {
        var result = _converter.Convert(
            NotificationSeverity.Success, typeof(Geometry), null, CultureInfo.InvariantCulture);
        result.Should().NotBe(Geometry.Empty);
    }

    [Fact]
    public void Convert_EachSeverity_ReturnsDistinctGeometry()
    {
        var success = _converter.Convert(NotificationSeverity.Success, typeof(Geometry), null!, CultureInfo.InvariantCulture);
        var warning = _converter.Convert(NotificationSeverity.Warning, typeof(Geometry), null!, CultureInfo.InvariantCulture);
        var error = _converter.Convert(NotificationSeverity.Error, typeof(Geometry), null!, CultureInfo.InvariantCulture);

        success.Should().NotBeSameAs(warning);
        warning.Should().NotBeSameAs(error);
    }

    [Fact]
    public void Convert_InvalidType_ReturnsUnsetValue()
    {
        var result = _converter.Convert("not a severity", typeof(Geometry), null!, CultureInfo.InvariantCulture);
        result.Should().Be(DependencyProperty.UnsetValue);
    }

    [Fact]
    public void Convert_FallbackToEmpty_WhenResourceNotGeometry()
    {
        var app = System.Windows.Application.Current!;
        var original = app.Resources["IconSuccess"];
        app.Resources["IconSuccess"] = "not-a-geometry";
        try
        {
            var result = _converter.Convert(NotificationSeverity.Success, typeof(Geometry), null!, CultureInfo.InvariantCulture);
            result.Should().Be(Geometry.Empty);
        }
        finally
        {
            app.Resources["IconSuccess"] = original;
        }
    }

    [Fact]
    public void Convert_NullValue_ReturnsUnsetValue()
    {
        var result = _converter.Convert(null!, typeof(Geometry), null!, CultureInfo.InvariantCulture);
        result.Should().Be(DependencyProperty.UnsetValue);
    }

    [Fact]
    public void ConvertBack_ThrowsNotSupportedException()
    {
        var act = () => _converter.ConvertBack(null!, typeof(NotificationSeverity), null!, CultureInfo.InvariantCulture);
        act.Should().Throw<NotSupportedException>();
    }
}
