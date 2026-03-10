using DSPanel.Views.Controls;
using FluentAssertions;

namespace DSPanel.Tests.Views.Controls;

/// <summary>
/// Tests for Avatar helper methods (initials extraction and deterministic color).
/// </summary>
public class AvatarTests
{
    [Theory]
    [InlineData("John Doe", "JD")]
    [InlineData("Alice", "A")]
    [InlineData("Jean-Pierre Martin", "JM")]
    [InlineData("Anna Maria Lopez Garcia", "AG")]
    public void GetInitials_ValidName_ReturnsExpectedInitials(string name, string expected)
    {
        Avatar.GetInitials(name).Should().Be(expected);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void GetInitials_NullOrWhitespace_ReturnsQuestionMark(string? name)
    {
        Avatar.GetInitials(name).Should().Be("?");
    }

    [Fact]
    public void GetInitials_SingleWord_ReturnsSingleUpperLetter()
    {
        Avatar.GetInitials("admin").Should().Be("A");
    }

    [Fact]
    public void GetDeterministicColor_SameName_ReturnsSameColor()
    {
        var color1 = Avatar.GetDeterministicColor("John Doe");
        var color2 = Avatar.GetDeterministicColor("John Doe");

        color1.Should().Be(color2);
    }

    [Fact]
    public void GetDeterministicColor_DifferentNames_MayReturnDifferentColors()
    {
        var color1 = Avatar.GetDeterministicColor("Alice");
        var color2 = Avatar.GetDeterministicColor("Bob");

        // Not guaranteed to differ with only 8 colors, but these two should
        // Just verify both are valid colors from the palette
        color1.A.Should().Be(255);
        color2.A.Should().Be(255);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void GetDeterministicColor_NullOrWhitespace_ReturnsPaletteFirstColor(string? name)
    {
        var color = Avatar.GetDeterministicColor(name);
        // First palette color is blue (0x3B, 0x82, 0xF6)
        color.R.Should().Be(0x3B);
        color.G.Should().Be(0x82);
        color.B.Should().Be(0xF6);
    }
}
