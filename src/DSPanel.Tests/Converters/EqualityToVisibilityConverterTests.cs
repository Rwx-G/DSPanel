using System.Globalization;
using System.Windows;
using DSPanel.Converters;
using FluentAssertions;

namespace DSPanel.Tests.Converters;

public class EqualityToVisibilityConverterTests
{
    private readonly EqualityToVisibilityConverter _converter = new();

    [Fact]
    public void Convert_EqualStrings_ReturnsVisible()
    {
        var values = new object?[] { "hello", "hello" };
        _converter.Convert(values, typeof(Visibility), null, CultureInfo.InvariantCulture)
            .Should().Be(Visibility.Visible);
    }

    [Fact]
    public void Convert_DifferentStrings_ReturnsCollapsed()
    {
        var values = new object?[] { "hello", "world" };
        _converter.Convert(values, typeof(Visibility), null, CultureInfo.InvariantCulture)
            .Should().Be(Visibility.Collapsed);
    }

    [Fact]
    public void Convert_CaseInsensitiveMatch_ReturnsVisible()
    {
        var values = new object?[] { "Hello", "HELLO" };
        _converter.Convert(values, typeof(Visibility), null, CultureInfo.InvariantCulture)
            .Should().Be(Visibility.Visible);
    }

    [Fact]
    public void Convert_BothNull_ReturnsVisible()
    {
        var values = new object?[] { null, null };
        _converter.Convert(values, typeof(Visibility), null, CultureInfo.InvariantCulture)
            .Should().Be(Visibility.Visible);
    }

    [Fact]
    public void Convert_OneNull_ReturnsCollapsed()
    {
        var values = new object?[] { "hello", null };
        _converter.Convert(values, typeof(Visibility), null, CultureInfo.InvariantCulture)
            .Should().Be(Visibility.Collapsed);
    }

    [Fact]
    public void Convert_LessThanTwoValues_ReturnsCollapsed()
    {
        var values = new object?[] { "hello" };
        _converter.Convert(values, typeof(Visibility), null, CultureInfo.InvariantCulture)
            .Should().Be(Visibility.Collapsed);
    }

    [Fact]
    public void Convert_NonStringTypes_ComparesToString()
    {
        var values = new object?[] { 42, 42 };
        _converter.Convert(values, typeof(Visibility), null, CultureInfo.InvariantCulture)
            .Should().Be(Visibility.Visible);
    }

    [Fact]
    public void ConvertBack_ThrowsNotSupportedException()
    {
        var act = () => _converter.ConvertBack(Visibility.Visible, [typeof(string), typeof(string)], null, CultureInfo.InvariantCulture);
        act.Should().Throw<NotSupportedException>();
    }
}
