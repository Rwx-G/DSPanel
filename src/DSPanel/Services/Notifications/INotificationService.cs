using System.Collections.ObjectModel;

namespace DSPanel.Services.Notifications;

public interface INotificationService
{
    ObservableCollection<NotificationItem> Notifications { get; }
    void Show(string message, NotificationSeverity severity = NotificationSeverity.Info, int durationMs = 5000);
    void Dismiss(NotificationItem item);
}

public enum NotificationSeverity
{
    Info,
    Success,
    Warning,
    Error
}

public sealed class NotificationItem
{
    public required string Message { get; init; }
    public required NotificationSeverity Severity { get; init; }
    public required int DurationMs { get; init; }
    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
}
