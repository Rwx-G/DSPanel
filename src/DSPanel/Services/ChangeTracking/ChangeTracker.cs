namespace DSPanel.Services.ChangeTracking;

/// <summary>
/// Tracks property changes against a clean snapshot using name/value pairs.
/// </summary>
public class ChangeTracker : IChangeTracker
{
    private readonly Dictionary<string, object?> _snapshot = new();
    private readonly Func<Dictionary<string, object?>> _getCurrentValues;

    /// <summary>
    /// Creates a new ChangeTracker.
    /// </summary>
    /// <param name="getCurrentValues">
    /// A function that returns a dictionary of property name to current value.
    /// </param>
    public ChangeTracker(Func<Dictionary<string, object?>> getCurrentValues)
    {
        _getCurrentValues = getCurrentValues;
    }

    public bool IsDirty
    {
        get
        {
            if (_snapshot.Count == 0)
                return false;

            var current = _getCurrentValues();
            foreach (var kvp in _snapshot)
            {
                if (!current.TryGetValue(kvp.Key, out var currentValue))
                    return true;

                if (!Equals(kvp.Value, currentValue))
                    return true;
            }

            return false;
        }
    }

    public void MarkClean()
    {
        _snapshot.Clear();
        foreach (var kvp in _getCurrentValues())
        {
            _snapshot[kvp.Key] = kvp.Value;
        }
    }

    public void Reset()
    {
        // Caller is responsible for applying snapshot values back to properties.
        // This method exposes the snapshot for that purpose.
    }

    /// <summary>
    /// Returns the clean snapshot values, for use when resetting properties.
    /// </summary>
    public IReadOnlyDictionary<string, object?> Snapshot => _snapshot;
}
