using System.Globalization;
using System.Windows;
using DSPanel.Converters;
using FluentAssertions;

namespace DSPanel.Tests.Converters;

public class BoolToVisibilityConverterTests
{
    private readonly BoolToVisibilityConverter _converter = new();

    [Theory]
    [InlineData(true, Visibility.Visible)]
    [InlineData(false, Visibility.Collapsed)]
    public void Convert_BoolValue_ReturnsExpectedVisibility(bool input, Visibility expected)
    {
        _converter.Convert(input, typeof(Visibility), null, CultureInfo.InvariantCulture)
            .Should().Be(expected);
    }

    [Theory]
    [InlineData(true, Visibility.Collapsed)]
    [InlineData(false, Visibility.Visible)]
    public void Convert_WithInvertParameter_ReversesLogic(bool input, Visibility expected)
    {
        _converter.Convert(input, typeof(Visibility), "Invert", CultureInfo.InvariantCulture)
            .Should().Be(expected);
    }

    [Fact]
    public void Convert_InvertIsCaseInsensitive()
    {
        _converter.Convert(true, typeof(Visibility), "invert", CultureInfo.InvariantCulture)
            .Should().Be(Visibility.Collapsed);
    }

    [Fact]
    public void Convert_NullValue_ReturnsCollapsed()
    {
        _converter.Convert(null, typeof(Visibility), null, CultureInfo.InvariantCulture)
            .Should().Be(Visibility.Collapsed);
    }

    [Fact]
    public void Convert_NonBoolValue_ReturnsCollapsed()
    {
        _converter.Convert("hello", typeof(Visibility), null, CultureInfo.InvariantCulture)
            .Should().Be(Visibility.Collapsed);
    }

    [Theory]
    [InlineData(Visibility.Visible, true)]
    [InlineData(Visibility.Collapsed, false)]
    [InlineData(Visibility.Hidden, false)]
    public void ConvertBack_Visibility_ReturnsBool(Visibility input, bool expected)
    {
        _converter.ConvertBack(input, typeof(bool), null, CultureInfo.InvariantCulture)
            .Should().Be(expected);
    }

    [Theory]
    [InlineData(Visibility.Visible, false)]
    [InlineData(Visibility.Collapsed, true)]
    public void ConvertBack_WithInvert_ReversesLogic(Visibility input, bool expected)
    {
        _converter.ConvertBack(input, typeof(bool), "Invert", CultureInfo.InvariantCulture)
            .Should().Be(expected);
    }

    [Fact]
    public void Convert_NonInvertStringParameter_DoesNotInvert()
    {
        _converter.Convert(true, typeof(Visibility), "SomethingElse", CultureInfo.InvariantCulture)
            .Should().Be(Visibility.Visible);
    }

    [Fact]
    public void ConvertBack_NonInvertStringParameter_DoesNotInvert()
    {
        _converter.ConvertBack(Visibility.Visible, typeof(bool), "Other", CultureInfo.InvariantCulture)
            .Should().Be(true);
    }

    [Fact]
    public void ConvertBack_HiddenWithInvert_ReturnsTrue()
    {
        _converter.ConvertBack(Visibility.Hidden, typeof(bool), "Invert", CultureInfo.InvariantCulture)
            .Should().Be(true);
    }

    [Fact]
    public void ConvertBack_NonVisibilityValue_ReturnsFalse()
    {
        _converter.ConvertBack("not-visibility", typeof(bool), null, CultureInfo.InvariantCulture)
            .Should().Be(false);
    }
}
