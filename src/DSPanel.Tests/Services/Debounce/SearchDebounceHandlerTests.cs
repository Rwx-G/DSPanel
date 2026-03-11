using DSPanel.Services.Debounce;
using FluentAssertions;
using Moq;

namespace DSPanel.Tests.Services.Debounce;

public class SearchDebounceHandlerTests
{
    private readonly Mock<IDebounceTimer> _mockTimer = new();

    [Fact]
    public void OnTextChanged_RestartsTimerWithDelay()
    {
        var delay = TimeSpan.FromMilliseconds(300);
        var handler = new SearchDebounceHandler(_mockTimer.Object, delay, _ => { });

        handler.OnTextChanged("hello");

        _mockTimer.Verify(t => t.Restart(delay, It.IsAny<Action>()), Times.Once);
    }

    [Fact]
    public void OnTextChanged_CallbackReceivesLatestText()
    {
        string? receivedText = null;
        Action? capturedCallback = null;
        var delay = TimeSpan.FromMilliseconds(300);

        _mockTimer.Setup(t => t.Restart(It.IsAny<TimeSpan>(), It.IsAny<Action>()))
            .Callback<TimeSpan, Action>((_, cb) => capturedCallback = cb);

        var handler = new SearchDebounceHandler(_mockTimer.Object, delay, text => receivedText = text);

        handler.OnTextChanged("first");
        handler.OnTextChanged("second");

        // Simulate timer firing - should get the latest text
        capturedCallback!.Invoke();

        receivedText.Should().Be("second");
    }

    [Fact]
    public void Cancel_StopsTimer()
    {
        var handler = new SearchDebounceHandler(_mockTimer.Object, TimeSpan.FromMilliseconds(300), _ => { });

        handler.Cancel();

        _mockTimer.Verify(t => t.Stop(), Times.Once);
    }

    [Fact]
    public void OnTextChanged_MultipleRapidCalls_RestartsEachTime()
    {
        var handler = new SearchDebounceHandler(_mockTimer.Object, TimeSpan.FromMilliseconds(300), _ => { });

        handler.OnTextChanged("a");
        handler.OnTextChanged("ab");
        handler.OnTextChanged("abc");

        _mockTimer.Verify(t => t.Restart(It.IsAny<TimeSpan>(), It.IsAny<Action>()), Times.Exactly(3));
    }
}
