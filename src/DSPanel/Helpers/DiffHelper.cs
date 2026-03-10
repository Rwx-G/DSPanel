using DSPanel.Models;

namespace DSPanel.Helpers;

/// <summary>
/// Pure logic for splitting diff lines into left/right views, extracted for testability.
/// </summary>
public static class DiffHelper
{
    /// <summary>
    /// Splits diff lines into left (Removed + Unchanged) and right (Added + Unchanged) lists
    /// for side-by-side display.
    /// </summary>
    public static (IReadOnlyList<DiffLine> Left, IReadOnlyList<DiffLine> Right) SplitForSideBySide(
        IReadOnlyList<DiffLine>? lines)
    {
        if (lines is null or { Count: 0 })
            return ([], []);

        var left = new List<DiffLine>();
        var right = new List<DiffLine>();

        foreach (var line in lines)
        {
            if (line.Type is DiffLineType.Removed or DiffLineType.Unchanged)
                left.Add(line);
            if (line.Type is DiffLineType.Added or DiffLineType.Unchanged)
                right.Add(line);
        }

        return (left, right);
    }
}
