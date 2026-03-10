using System.Windows.Threading;

namespace DSPanel.Services.Debounce;

/// <summary>
/// Production debounce timer backed by WPF DispatcherTimer.
/// </summary>
public class DispatcherDebounceTimer : IDebounceTimer
{
    private readonly DispatcherTimer _timer = new();
    private Action? _callback;

    public DispatcherDebounceTimer()
    {
        _timer.Tick += OnTick;
    }

    public void Restart(TimeSpan delay, Action callback)
    {
        _timer.Stop();
        _callback = callback;
        _timer.Interval = delay;
        _timer.Start();
    }

    public void Stop()
    {
        _timer.Stop();
        _callback = null;
    }

    private void OnTick(object? sender, EventArgs e)
    {
        _timer.Stop();
        _callback?.Invoke();
    }
}
