namespace DSPanel.Services.Debounce;

/// <summary>
/// Abstraction over a debounce timer for testability.
/// </summary>
public interface IDebounceTimer
{
    /// <summary>
    /// Restarts the debounce timer with the given delay. When the delay
    /// elapses without another Restart call, the callback is invoked.
    /// </summary>
    void Restart(TimeSpan delay, Action callback);

    /// <summary>
    /// Stops the timer without invoking the callback.
    /// </summary>
    void Stop();
}
