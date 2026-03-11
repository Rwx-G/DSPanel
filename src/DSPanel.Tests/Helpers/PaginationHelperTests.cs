using DSPanel.Helpers;
using FluentAssertions;

namespace DSPanel.Tests.Helpers;

public class PaginationHelperTests
{
    // ---- CalculateTotalPages ----

    [Theory]
    [InlineData(100, 25, 4)]
    [InlineData(101, 25, 5)]
    [InlineData(1, 25, 1)]
    [InlineData(25, 25, 1)]
    [InlineData(26, 25, 2)]
    [InlineData(0, 25, 1)]
    [InlineData(50, 10, 5)]
    [InlineData(50, 50, 1)]
    [InlineData(50, 100, 1)]
    public void CalculateTotalPages_ReturnsExpected(int totalItems, int pageSize, int expected)
    {
        PaginationHelper.CalculateTotalPages(totalItems, pageSize).Should().Be(expected);
    }

    [Fact]
    public void CalculateTotalPages_NegativeItems_ReturnsOne()
    {
        PaginationHelper.CalculateTotalPages(-5, 25).Should().Be(1);
    }

    [Fact]
    public void CalculateTotalPages_ZeroPageSize_ReturnsOne()
    {
        PaginationHelper.CalculateTotalPages(100, 0).Should().Be(1);
    }

    // ---- FormatDisplayRange ----

    [Fact]
    public void FormatDisplayRange_ZeroItems_ReturnsNoItems()
    {
        PaginationHelper.FormatDisplayRange(1, 25, 0).Should().Be("No items");
    }

    [Fact]
    public void FormatDisplayRange_FirstPage_ShowsCorrectRange()
    {
        PaginationHelper.FormatDisplayRange(1, 25, 100).Should().Be("Showing 1-25 of 100");
    }

    [Fact]
    public void FormatDisplayRange_MiddlePage_ShowsCorrectRange()
    {
        PaginationHelper.FormatDisplayRange(2, 25, 100).Should().Be("Showing 26-50 of 100");
    }

    [Fact]
    public void FormatDisplayRange_LastPage_ClampsToTotal()
    {
        PaginationHelper.FormatDisplayRange(4, 25, 90).Should().Be("Showing 76-90 of 90");
    }

    [Fact]
    public void FormatDisplayRange_PageBeyondTotal_ClampsToLastPage()
    {
        PaginationHelper.FormatDisplayRange(99, 25, 50).Should().Be("Showing 26-50 of 50");
    }

    [Fact]
    public void FormatDisplayRange_SingleItem_ShowsOneToOne()
    {
        PaginationHelper.FormatDisplayRange(1, 25, 1).Should().Be("Showing 1-1 of 1");
    }

    // ---- ClampPage ----

    [Theory]
    [InlineData(1, 5, 1)]
    [InlineData(3, 5, 3)]
    [InlineData(5, 5, 5)]
    [InlineData(0, 5, 1)]
    [InlineData(-1, 5, 1)]
    [InlineData(10, 5, 5)]
    [InlineData(1, 0, 1)]
    public void ClampPage_ReturnsExpected(int page, int totalPages, int expected)
    {
        PaginationHelper.ClampPage(page, totalPages).Should().Be(expected);
    }
}
