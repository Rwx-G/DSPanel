namespace DSPanel.Helpers;

/// <summary>
/// Pure calculation logic for pagination, extracted for testability.
/// </summary>
public static class PaginationHelper
{
    /// <summary>
    /// Calculates the total number of pages.
    /// </summary>
    public static int CalculateTotalPages(int totalItems, int pageSize)
    {
        if (totalItems <= 0 || pageSize <= 0)
            return 1;

        return (int)Math.Ceiling((double)totalItems / pageSize);
    }

    /// <summary>
    /// Builds the display string for the current page range (e.g. "Showing 1-25 of 100").
    /// </summary>
    public static string FormatDisplayRange(int currentPage, int pageSize, int totalItems)
    {
        if (totalItems == 0)
            return "No items";

        var totalPages = CalculateTotalPages(totalItems, pageSize);
        var page = Math.Clamp(currentPage, 1, totalPages);
        var start = Math.Min((page - 1) * pageSize + 1, totalItems);
        var end = Math.Min(page * pageSize, totalItems);

        return $"Showing {start}-{end} of {totalItems}";
    }

    /// <summary>
    /// Returns the clamped page number within valid bounds.
    /// </summary>
    public static int ClampPage(int page, int totalPages)
    {
        return Math.Clamp(page, 1, Math.Max(1, totalPages));
    }
}
