using DSPanel.Services.Notifications;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Moq;

namespace DSPanel.Tests.Services.Notifications;

public class NotificationServiceTests
{
    private readonly Mock<ILogger<NotificationService>> _logger = new();

    private NotificationService CreateSut(
        Action<Action>? dispatcher = null,
        Func<int, CancellationToken, Task>? delayFunc = null)
    {
        return new NotificationService(_logger.Object, dispatcher, delayFunc);
    }

    [Fact]
    public void Notifications_Initially_IsEmpty()
    {
        var sut = CreateSut();
        sut.Notifications.Should().BeEmpty();
    }

    [Fact]
    public void Show_AddsNotificationToCollection()
    {
        var sut = CreateSut();
        sut.Show("Test message", NotificationSeverity.Info, durationMs: 0);

        sut.Notifications.Should().HaveCount(1);
        sut.Notifications[0].Message.Should().Be("Test message");
        sut.Notifications[0].Severity.Should().Be(NotificationSeverity.Info);
    }

    [Fact]
    public void Show_WithDifferentSeverities_SetsCorrectSeverity()
    {
        var sut = CreateSut();
        sut.Show("Success", NotificationSeverity.Success, durationMs: 0);
        sut.Show("Warning", NotificationSeverity.Warning, durationMs: 0);
        sut.Show("Error", NotificationSeverity.Error, durationMs: 0);

        sut.Notifications.Should().HaveCount(3);
        sut.Notifications[0].Severity.Should().Be(NotificationSeverity.Success);
        sut.Notifications[1].Severity.Should().Be(NotificationSeverity.Warning);
        sut.Notifications[2].Severity.Should().Be(NotificationSeverity.Error);
    }

    [Fact]
    public void Dismiss_RemovesNotificationFromCollection()
    {
        var sut = CreateSut();
        sut.Show("To dismiss", durationMs: 0);
        var item = sut.Notifications[0];

        sut.Dismiss(item);

        sut.Notifications.Should().BeEmpty();
    }

    [Fact]
    public void Dismiss_NonExistentItem_DoesNotThrow()
    {
        var sut = CreateSut();
        var item = new NotificationItem
        {
            Message = "Ghost",
            Severity = NotificationSeverity.Info,
            DurationMs = 0
        };

        var act = () => sut.Dismiss(item);
        act.Should().NotThrow();
    }

    [Fact]
    public void Show_MultipleNotifications_MaintainsOrder()
    {
        var sut = CreateSut();
        sut.Show("First", durationMs: 0);
        sut.Show("Second", durationMs: 0);
        sut.Show("Third", durationMs: 0);

        sut.Notifications.Should().HaveCount(3);
        sut.Notifications[0].Message.Should().Be("First");
        sut.Notifications[1].Message.Should().Be("Second");
        sut.Notifications[2].Message.Should().Be("Third");
    }

    [Fact]
    public void Show_WithDefaultDuration_AddsItem()
    {
        // Use a delay func that never completes during the test
        var tcs = new TaskCompletionSource<bool>();
        var sut = CreateSut(delayFunc: (_, _) => tcs.Task);

        sut.Show("Default duration");

        sut.Notifications.Should().HaveCount(1);
        sut.Notifications[0].DurationMs.Should().Be(5000);
    }

    [Fact]
    public async Task Show_WithPositiveDuration_AutoDismissesAfterDelay()
    {
        var delayTcs = new TaskCompletionSource();
        var sut = CreateSut(delayFunc: (_, _) => delayTcs.Task);

        sut.Show("Auto dismiss", durationMs: 1000);

        sut.Notifications.Should().HaveCount(1);

        // Simulate the delay completing
        delayTcs.SetResult();
        // Allow the continuation to run
        await Task.Yield();

        sut.Notifications.Should().BeEmpty();
    }

    [Fact]
    public async Task Show_WithPositiveDuration_PassesCorrectDurationToDelay()
    {
        int capturedMs = 0;
        var tcs = new TaskCompletionSource();
        var sut = CreateSut(delayFunc: (ms, _) =>
        {
            capturedMs = ms;
            return tcs.Task;
        });

        sut.Show("Timed", durationMs: 3000);

        capturedMs.Should().Be(3000);
        tcs.SetResult();
        await Task.Yield();
    }

    [Fact]
    public void Show_WithZeroDuration_DoesNotAutoDismiss()
    {
        bool delayCalled = false;
        var sut = CreateSut(delayFunc: (_, _) =>
        {
            delayCalled = true;
            return Task.CompletedTask;
        });

        sut.Show("Sticky", durationMs: 0);

        delayCalled.Should().BeFalse();
        sut.Notifications.Should().HaveCount(1);
    }

    [Fact]
    public async Task Show_WhenDelayCancelled_DoesNotThrow()
    {
        var tcs = new TaskCompletionSource();
        var sut = CreateSut(delayFunc: (_, _) => tcs.Task);

        sut.Show("Cancel test", durationMs: 1000);

        // Simulate cancellation
        tcs.SetCanceled();
        await Task.Yield();

        // Item should remain since dismiss was not called
        sut.Notifications.Should().HaveCount(1);
    }

    [Fact]
    public void Show_UsesDispatcherForAdd()
    {
        bool dispatcherCalled = false;
        var sut = CreateSut(dispatcher: action =>
        {
            dispatcherCalled = true;
            action();
        });

        sut.Show("Dispatched", durationMs: 0);

        dispatcherCalled.Should().BeTrue();
        sut.Notifications.Should().HaveCount(1);
    }

    [Fact]
    public void Dismiss_UsesDispatcherForRemove()
    {
        int dispatchCount = 0;
        var sut = CreateSut(dispatcher: action =>
        {
            dispatchCount++;
            action();
        });

        sut.Show("To remove", durationMs: 0);
        var item = sut.Notifications[0];
        dispatchCount = 0; // Reset after Show's dispatch

        sut.Dismiss(item);

        dispatchCount.Should().Be(1);
        sut.Notifications.Should().BeEmpty();
    }

    [Fact]
    public void Show_SetsCreatedAtOnItem()
    {
        var before = DateTime.UtcNow;
        var sut = CreateSut();

        sut.Show("Timestamped", durationMs: 0);

        var after = DateTime.UtcNow;
        sut.Notifications[0].CreatedAt.Should().BeOnOrAfter(before).And.BeOnOrBefore(after);
    }
}
