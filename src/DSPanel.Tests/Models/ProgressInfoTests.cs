using DSPanel.Models;
using FluentAssertions;

namespace DSPanel.Tests.Models;

public class ProgressInfoTests
{
    [Fact]
    public void Constructor_SetsAllProperties()
    {
        var info = new ProgressInfo(75.5, "Loading...", true);

        info.Percentage.Should().Be(75.5);
        info.StatusMessage.Should().Be("Loading...");
        info.IsIndeterminate.Should().BeTrue();
    }

    [Fact]
    public void IsIndeterminate_DefaultsToFalse()
    {
        var info = new ProgressInfo(50, "Working");
        info.IsIndeterminate.Should().BeFalse();
    }

    [Fact]
    public void Record_Equality_WorksCorrectly()
    {
        var a = new ProgressInfo(100, "Done");
        var b = new ProgressInfo(100, "Done");

        a.Should().Be(b);
    }
}
