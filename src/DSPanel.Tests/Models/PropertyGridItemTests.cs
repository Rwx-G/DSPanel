using DSPanel.Models;
using FluentAssertions;

namespace DSPanel.Tests.Models;

public class PropertyGridItemTests
{
    [Fact]
    public void Constructor_SetsAllProperties()
    {
        var item = new PropertyGridItem("Name", "John Doe", "General", true);

        item.Label.Should().Be("Name");
        item.Value.Should().Be("John Doe");
        item.Category.Should().Be("General");
        item.IsCopyable.Should().BeTrue();
    }

    [Fact]
    public void Category_DefaultsToNull()
    {
        var item = new PropertyGridItem("Label", "Value");
        item.Category.Should().BeNull();
    }

    [Fact]
    public void IsCopyable_DefaultsToFalse()
    {
        var item = new PropertyGridItem("Label", "Value");
        item.IsCopyable.Should().BeFalse();
    }

    [Fact]
    public void Value_CanBeNull()
    {
        var item = new PropertyGridItem("Label", null);
        item.Value.Should().BeNull();
    }

    [Fact]
    public void Record_Equality_WorksCorrectly()
    {
        var a = new PropertyGridItem("Name", "John");
        var b = new PropertyGridItem("Name", "John");

        a.Should().Be(b);
    }
}
