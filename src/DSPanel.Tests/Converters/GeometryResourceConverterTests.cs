using System.Globalization;
using System.Windows.Media;
using DSPanel.Converters;
using DSPanel.Tests.TestHelpers;
using FluentAssertions;

namespace DSPanel.Tests.Converters;

[Collection("WpfApp")]
public class GeometryResourceConverterTests
{
    private readonly GeometryResourceConverter _converter = GeometryResourceConverter.Instance;

    [Fact]
    public void Convert_ExistingKey_ReturnsGeometry()
    {
        var result = _converter.Convert("IconUser", typeof(Geometry), null, CultureInfo.InvariantCulture);
        result.Should().BeOfType<StreamGeometry>();
    }

    [Fact]
    public void Convert_NonExistingKey_ReturnsNull()
    {
        var result = _converter.Convert("IconDoesNotExist", typeof(Geometry), null, CultureInfo.InvariantCulture);
        result.Should().BeNull();
    }

    [Fact]
    public void Convert_NullValue_ReturnsNull()
    {
        var result = _converter.Convert(null, typeof(Geometry), null, CultureInfo.InvariantCulture);
        result.Should().BeNull();
    }

    [Fact]
    public void Convert_EmptyString_ReturnsNull()
    {
        var result = _converter.Convert("", typeof(Geometry), null, CultureInfo.InvariantCulture);
        result.Should().BeNull();
    }

    [Fact]
    public void Convert_NonStringValue_ReturnsNull()
    {
        var result = _converter.Convert(42, typeof(Geometry), null, CultureInfo.InvariantCulture);
        result.Should().BeNull();
    }

    [Fact]
    public void Instance_IsSingleton()
    {
        GeometryResourceConverter.Instance.Should().BeSameAs(_converter);
    }

    [Fact]
    public void ConvertBack_ThrowsNotSupportedException()
    {
        var act = () => _converter.ConvertBack(null, typeof(string), null, CultureInfo.InvariantCulture);
        act.Should().Throw<NotSupportedException>();
    }
}
