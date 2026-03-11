using DSPanel.Helpers;
using DSPanel.Models;
using FluentAssertions;

namespace DSPanel.Tests.Helpers;

public class DiffHelperTests
{
    [Fact]
    public void SplitForSideBySide_Null_ReturnsBothEmpty()
    {
        var (left, right) = DiffHelper.SplitForSideBySide(null);
        left.Should().BeEmpty();
        right.Should().BeEmpty();
    }

    [Fact]
    public void SplitForSideBySide_EmptyList_ReturnsBothEmpty()
    {
        var (left, right) = DiffHelper.SplitForSideBySide([]);
        left.Should().BeEmpty();
        right.Should().BeEmpty();
    }

    [Fact]
    public void SplitForSideBySide_UnchangedLines_AppearInBoth()
    {
        var lines = new List<DiffLine>
        {
            new(DiffLineType.Unchanged, "same line", 1, 1)
        };

        var (left, right) = DiffHelper.SplitForSideBySide(lines);

        left.Should().HaveCount(1);
        right.Should().HaveCount(1);
        left[0].Content.Should().Be("same line");
        right[0].Content.Should().Be("same line");
    }

    [Fact]
    public void SplitForSideBySide_AddedLine_OnlyInRight()
    {
        var lines = new List<DiffLine>
        {
            new(DiffLineType.Added, "new line", null, 1)
        };

        var (left, right) = DiffHelper.SplitForSideBySide(lines);

        left.Should().BeEmpty();
        right.Should().HaveCount(1);
        right[0].Content.Should().Be("new line");
    }

    [Fact]
    public void SplitForSideBySide_RemovedLine_OnlyInLeft()
    {
        var lines = new List<DiffLine>
        {
            new(DiffLineType.Removed, "old line", 1, null)
        };

        var (left, right) = DiffHelper.SplitForSideBySide(lines);

        left.Should().HaveCount(1);
        left[0].Content.Should().Be("old line");
        right.Should().BeEmpty();
    }

    [Fact]
    public void SplitForSideBySide_MixedLines_SplitsCorrectly()
    {
        var lines = new List<DiffLine>
        {
            new(DiffLineType.Unchanged, "context", 1, 1),
            new(DiffLineType.Removed, "deleted", 2, null),
            new(DiffLineType.Added, "inserted", null, 2),
            new(DiffLineType.Unchanged, "more context", 3, 3)
        };

        var (left, right) = DiffHelper.SplitForSideBySide(lines);

        left.Should().HaveCount(3); // context + deleted + more context
        right.Should().HaveCount(3); // context + inserted + more context

        left.Select(l => l.Type).Should().ContainInOrder(
            DiffLineType.Unchanged, DiffLineType.Removed, DiffLineType.Unchanged);
        right.Select(l => l.Type).Should().ContainInOrder(
            DiffLineType.Unchanged, DiffLineType.Added, DiffLineType.Unchanged);
    }

    [Fact]
    public void SplitForSideBySide_AllRemoved_RightIsEmpty()
    {
        var lines = new List<DiffLine>
        {
            new(DiffLineType.Removed, "line 1", 1, null),
            new(DiffLineType.Removed, "line 2", 2, null),
            new(DiffLineType.Removed, "line 3", 3, null)
        };

        var (left, right) = DiffHelper.SplitForSideBySide(lines);

        left.Should().HaveCount(3);
        right.Should().BeEmpty();
    }

    [Fact]
    public void SplitForSideBySide_AllAdded_LeftIsEmpty()
    {
        var lines = new List<DiffLine>
        {
            new(DiffLineType.Added, "line 1", null, 1),
            new(DiffLineType.Added, "line 2", null, 2)
        };

        var (left, right) = DiffHelper.SplitForSideBySide(lines);

        left.Should().BeEmpty();
        right.Should().HaveCount(2);
    }
}
