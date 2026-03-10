namespace DSPanel.Services.Debounce;

/// <summary>
/// Encapsulates debounce logic for search operations.
/// Testable without WPF dependencies when using a mock IDebounceTimer.
/// </summary>
public class SearchDebounceHandler
{
    private readonly IDebounceTimer _timer;
    private readonly TimeSpan _delay;
    private readonly Action<string> _onSearch;
    private string _pendingText = string.Empty;

    public SearchDebounceHandler(IDebounceTimer timer, TimeSpan delay, Action<string> onSearch)
    {
        _timer = timer;
        _delay = delay;
        _onSearch = onSearch;
    }

    /// <summary>
    /// Called when the search text changes. Restarts the debounce timer.
    /// </summary>
    public void OnTextChanged(string text)
    {
        _pendingText = text;
        _timer.Restart(_delay, () => _onSearch(_pendingText));
    }

    /// <summary>
    /// Cancels any pending debounced search.
    /// </summary>
    public void Cancel()
    {
        _timer.Stop();
    }
}
