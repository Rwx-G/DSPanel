namespace DSPanel.Services.ChangeTracking;

/// <summary>
/// Tracks whether a form ViewModel has unsaved changes.
/// </summary>
public interface IChangeTracker
{
    /// <summary>
    /// True if any tracked property differs from its clean snapshot.
    /// </summary>
    bool IsDirty { get; }

    /// <summary>
    /// Captures a snapshot of current values as the "clean" baseline.
    /// </summary>
    void MarkClean();

    /// <summary>
    /// Resets all tracked properties to their clean snapshot values.
    /// </summary>
    void Reset();
}
