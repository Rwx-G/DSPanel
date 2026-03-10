using System.Globalization;
using System.Windows;
using DSPanel.Converters;
using FluentAssertions;

namespace DSPanel.Tests.Converters;

public class NonEmptyStringToVisibilityConverterTests
{
    private readonly NonEmptyStringToVisibilityConverter _converter = new();

    [Theory]
    [InlineData("hello", Visibility.Visible)]
    [InlineData("  text  ", Visibility.Visible)]
    [InlineData("", Visibility.Collapsed)]
    [InlineData(null, Visibility.Collapsed)]
    public void Convert_StringValue_ReturnsExpectedVisibility(string? input, Visibility expected)
    {
        _converter.Convert(input, typeof(Visibility), null, CultureInfo.InvariantCulture)
            .Should().Be(expected);
    }

    [Fact]
    public void Convert_NonStringValue_ReturnsCollapsed()
    {
        _converter.Convert(42, typeof(Visibility), null, CultureInfo.InvariantCulture)
            .Should().Be(Visibility.Collapsed);
    }

    [Fact]
    public void ConvertBack_ThrowsNotSupportedException()
    {
        var act = () => _converter.ConvertBack(Visibility.Visible, typeof(string), null, CultureInfo.InvariantCulture);
        act.Should().Throw<NotSupportedException>();
    }
}
