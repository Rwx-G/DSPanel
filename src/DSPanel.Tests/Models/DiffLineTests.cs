using DSPanel.Models;

namespace DSPanel.Tests.Models;

public sealed class DiffLineTests
{
    [Fact]
    public void DiffLine_RecordEquality()
    {
        var a = new DiffLine(DiffLineType.Added, "hello", null, 1);
        var b = new DiffLine(DiffLineType.Added, "hello", null, 1);
        Assert.Equal(a, b);
    }

    [Fact]
    public void DiffLine_RecordInequality()
    {
        var a = new DiffLine(DiffLineType.Added, "hello", null, 1);
        var b = new DiffLine(DiffLineType.Removed, "hello", 1, null);
        Assert.NotEqual(a, b);
    }

    [Theory]
    [InlineData(DiffLineType.Unchanged)]
    [InlineData(DiffLineType.Added)]
    [InlineData(DiffLineType.Removed)]
    public void DiffLineType_AllValuesExist(DiffLineType type)
    {
        Assert.True(Enum.IsDefined(type));
    }

    [Fact]
    public void DiffLine_PreservesContent()
    {
        var line = new DiffLine(DiffLineType.Unchanged, "  indented line", 5, 5);
        Assert.Equal("  indented line", line.Content);
        Assert.Equal(5, line.OldLineNumber);
        Assert.Equal(5, line.NewLineNumber);
    }
}
