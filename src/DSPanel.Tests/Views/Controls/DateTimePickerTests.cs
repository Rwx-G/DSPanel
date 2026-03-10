using DSPanel.Views.Controls;
using FluentAssertions;

namespace DSPanel.Tests.Views.Controls;

public class DateTimePickerTests
{
    [Theory]
    [InlineData("5", 0, 23, 5)]
    [InlineData("23", 0, 23, 23)]
    [InlineData("99", 0, 23, 23)]
    [InlineData("-1", 0, 23, 0)]
    [InlineData("abc", 0, 23, 0)]
    [InlineData(null, 0, 59, 0)]
    [InlineData("", 0, 59, 0)]
    [InlineData("30", 0, 59, 30)]
    [InlineData("60", 0, 59, 59)]
    public void ParseClamp_VariousInputs_ReturnsExpected(string? input, int min, int max, int expected)
    {
        DateTimePicker.ParseClamp(input, min, max).Should().Be(expected);
    }
}
