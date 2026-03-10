using DSPanel.Services.Notifications;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Moq;

namespace DSPanel.Tests.Services.Notifications;

public class NotificationServiceTests
{
    private readonly NotificationService _sut;

    public NotificationServiceTests()
    {
        var logger = new Mock<ILogger<NotificationService>>();
        _sut = new NotificationService(logger.Object);
    }

    [Fact]
    public void Notifications_Initially_IsEmpty()
    {
        _sut.Notifications.Should().BeEmpty();
    }

    [Fact]
    public void Show_AddsNotificationToCollection()
    {
        _sut.Show("Test message", NotificationSeverity.Info, durationMs: 0);

        _sut.Notifications.Should().HaveCount(1);
        _sut.Notifications[0].Message.Should().Be("Test message");
        _sut.Notifications[0].Severity.Should().Be(NotificationSeverity.Info);
    }

    [Fact]
    public void Show_WithDifferentSeverities_SetsCorrectSeverity()
    {
        _sut.Show("Success", NotificationSeverity.Success, durationMs: 0);
        _sut.Show("Warning", NotificationSeverity.Warning, durationMs: 0);
        _sut.Show("Error", NotificationSeverity.Error, durationMs: 0);

        _sut.Notifications.Should().HaveCount(3);
        _sut.Notifications[0].Severity.Should().Be(NotificationSeverity.Success);
        _sut.Notifications[1].Severity.Should().Be(NotificationSeverity.Warning);
        _sut.Notifications[2].Severity.Should().Be(NotificationSeverity.Error);
    }

    [Fact]
    public void Dismiss_RemovesNotificationFromCollection()
    {
        _sut.Show("To dismiss", durationMs: 0);
        var item = _sut.Notifications[0];

        _sut.Dismiss(item);

        _sut.Notifications.Should().BeEmpty();
    }

    [Fact]
    public void Dismiss_NonExistentItem_DoesNotThrow()
    {
        var item = new NotificationItem
        {
            Message = "Ghost",
            Severity = NotificationSeverity.Info,
            DurationMs = 0
        };

        var act = () => _sut.Dismiss(item);
        act.Should().NotThrow();
    }

    [Fact]
    public void Show_MultipleNotifications_MaintainsOrder()
    {
        _sut.Show("First", durationMs: 0);
        _sut.Show("Second", durationMs: 0);
        _sut.Show("Third", durationMs: 0);

        _sut.Notifications.Should().HaveCount(3);
        _sut.Notifications[0].Message.Should().Be("First");
        _sut.Notifications[1].Message.Should().Be("Second");
        _sut.Notifications[2].Message.Should().Be("Third");
    }
}
