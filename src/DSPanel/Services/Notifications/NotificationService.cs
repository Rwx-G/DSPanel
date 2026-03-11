using System.Collections.ObjectModel;
using Microsoft.Extensions.Logging;

namespace DSPanel.Services.Notifications;

public class NotificationService : INotificationService
{
    private readonly ILogger<NotificationService> _logger;
    private readonly Action<Action> _dispatcher;
    private readonly Func<int, CancellationToken, Task> _delayFunc;

    public ObservableCollection<NotificationItem> Notifications { get; } = [];

    public NotificationService(
        ILogger<NotificationService> logger,
        Action<Action>? dispatcher = null,
        Func<int, CancellationToken, Task>? delayFunc = null)
    {
        _logger = logger;
        _dispatcher = dispatcher ?? (action => action());
        _delayFunc = delayFunc ?? Task.Delay;
    }

    public void Show(string message, NotificationSeverity severity = NotificationSeverity.Info, int durationMs = 5000)
    {
        var item = new NotificationItem
        {
            Message = message,
            Severity = severity,
            DurationMs = durationMs
        };

        _dispatcher(() => Notifications.Add(item));
        _logger.LogDebug("Toast shown: [{Severity}] {Message}", severity, message);

        if (durationMs > 0)
        {
            _ = AutoDismissAsync(item, durationMs);
        }
    }

    public void Dismiss(NotificationItem item)
    {
        _dispatcher(() => Notifications.Remove(item));
    }

    private async Task AutoDismissAsync(NotificationItem item, int durationMs)
    {
        try
        {
            await _delayFunc(durationMs, CancellationToken.None);
            Dismiss(item);
        }
        catch (TaskCanceledException)
        {
            // Ignore cancellation during shutdown
        }
    }
}
