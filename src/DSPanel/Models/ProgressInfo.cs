namespace DSPanel.Models;

/// <summary>
/// Progress report for long-running operations.
/// </summary>
public sealed record ProgressInfo(
    double Percentage,
    string StatusMessage,
    bool IsIndeterminate = false);
