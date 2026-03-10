using System.Collections.ObjectModel;
using System.Windows.Threading;
using Microsoft.Extensions.Logging;

namespace DSPanel.Services.Notifications;

public class NotificationService : INotificationService
{
    private readonly ILogger<NotificationService> _logger;
    private readonly Dispatcher _dispatcher;

    public ObservableCollection<NotificationItem> Notifications { get; } = [];

    public NotificationService(ILogger<NotificationService> logger)
    {
        _logger = logger;
        _dispatcher = Dispatcher.CurrentDispatcher;
    }

    public void Show(string message, NotificationSeverity severity = NotificationSeverity.Info, int durationMs = 5000)
    {
        var item = new NotificationItem
        {
            Message = message,
            Severity = severity,
            DurationMs = durationMs
        };

        _dispatcher.Invoke(() => Notifications.Add(item));
        _logger.LogDebug("Toast shown: [{Severity}] {Message}", severity, message);

        if (durationMs > 0)
        {
            var timer = new DispatcherTimer(DispatcherPriority.Normal, _dispatcher)
            {
                Interval = TimeSpan.FromMilliseconds(durationMs)
            };
            timer.Tick += (_, _) =>
            {
                timer.Stop();
                Dismiss(item);
            };
            timer.Start();
        }
    }

    public void Dismiss(NotificationItem item)
    {
        _dispatcher.Invoke(() => Notifications.Remove(item));
    }
}
