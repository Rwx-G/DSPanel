namespace DSPanel.Models;

/// <summary>
/// Represents a single label-value property for display in a PropertyGrid.
/// </summary>
public record PropertyGridItem(
    string Label,
    string? Value,
    string? Category = null,
    bool IsCopyable = false);
