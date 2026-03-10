using System.Globalization;
using System.Windows.Media;
using DSPanel.Converters;
using DSPanel.Services.Permissions;
using FluentAssertions;

namespace DSPanel.Tests.Converters;

public class PermissionLevelToColorConverterTests
{
    private readonly PermissionLevelToColorConverter _converter = new();

    [Fact]
    public void Convert_ReadOnly_ReturnsGrayBrush()
    {
        var result = _converter.Convert(PermissionLevel.ReadOnly, typeof(SolidColorBrush), null, CultureInfo.InvariantCulture);
        result.Should().BeOfType<SolidColorBrush>();
        ((SolidColorBrush)result).Color.Should().Be(Color.FromRgb(107, 114, 128));
    }

    [Fact]
    public void Convert_HelpDesk_ReturnsBlueBrush()
    {
        var result = _converter.Convert(PermissionLevel.HelpDesk, typeof(SolidColorBrush), null, CultureInfo.InvariantCulture);
        result.Should().BeOfType<SolidColorBrush>();
        ((SolidColorBrush)result).Color.Should().Be(Color.FromRgb(37, 99, 235));
    }

    [Fact]
    public void Convert_AccountOperator_ReturnsAmberBrush()
    {
        var result = _converter.Convert(PermissionLevel.AccountOperator, typeof(SolidColorBrush), null, CultureInfo.InvariantCulture);
        result.Should().BeOfType<SolidColorBrush>();
        ((SolidColorBrush)result).Color.Should().Be(Color.FromRgb(217, 119, 6));
    }

    [Fact]
    public void Convert_DomainAdmin_ReturnsRedBrush()
    {
        var result = _converter.Convert(PermissionLevel.DomainAdmin, typeof(SolidColorBrush), null, CultureInfo.InvariantCulture);
        result.Should().BeOfType<SolidColorBrush>();
        ((SolidColorBrush)result).Color.Should().Be(Color.FromRgb(220, 38, 38));
    }

    [Fact]
    public void Convert_NullValue_ReturnsReadOnlyBrush()
    {
        var result = _converter.Convert(null, typeof(SolidColorBrush), null, CultureInfo.InvariantCulture);
        result.Should().BeOfType<SolidColorBrush>();
        ((SolidColorBrush)result).Color.Should().Be(Color.FromRgb(107, 114, 128));
    }

    [Fact]
    public void Convert_InvalidType_ReturnsReadOnlyBrush()
    {
        var result = _converter.Convert("not a permission", typeof(SolidColorBrush), null, CultureInfo.InvariantCulture);
        result.Should().BeOfType<SolidColorBrush>();
    }

    [Fact]
    public void Convert_UnknownEnumValue_ReturnsReadOnlyBrush()
    {
        var result = _converter.Convert((PermissionLevel)99, typeof(SolidColorBrush), null, CultureInfo.InvariantCulture);
        result.Should().BeOfType<SolidColorBrush>();
        ((SolidColorBrush)result).Color.Should().Be(Color.FromRgb(107, 114, 128));
    }

    [Fact]
    public void ConvertBack_ThrowsNotSupportedException()
    {
        var act = () => _converter.ConvertBack(null, typeof(PermissionLevel), null, CultureInfo.InvariantCulture);
        act.Should().Throw<NotSupportedException>();
    }
}
